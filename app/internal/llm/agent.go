package llm

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"time"
)

// ErrAgentMaxTurns means the model never called the finish tool inside its
// turn budget.
var ErrAgentMaxTurns = errors.New("llm: agent used all turns without a final answer")

// ErrAgentStalled means the model stopped producing tool calls without
// finishing.
var ErrAgentStalled = errors.New("llm: agent stopped without a final answer")

// AgentTool is one callable function in a multi-turn agent run. Run receives
// the model's decoded arguments and returns any JSON-marshalable value.
type AgentTool struct {
	Name        string
	Description string
	Schema      json.RawMessage
	Run         func(ctx context.Context, args json.RawMessage) (any, error)
}

// AgentStep records one tool invocation during an agent run.
type AgentStep struct {
	Turn       int    `json:"turn"`
	Tool       string `json:"tool"`
	Args       string `json:"args,omitempty"`
	Result     string `json:"result,omitempty"`
	Error      bool   `json:"error,omitempty"`
	DurationMs int64  `json:"duration_ms,omitempty"`
}

// AgentRun is the outcome of one agent conversation.
type AgentRun struct {
	Output    json.RawMessage
	Turns     int
	ToolCalls []string
	Steps     []AgentStep
}

func recordAgentStep(run *AgentRun, turn int, tool, args, result string, isError bool, elapsed time.Duration) {
	run.ToolCalls = append(run.ToolCalls, tool)
	run.Steps = append(run.Steps, AgentStep{
		Turn:       turn,
		Tool:       tool,
		Args:       truncateTraceText(args, 400),
		Result:     truncateTraceText(result, 400),
		Error:      isError,
		DurationMs: elapsed.Milliseconds(),
	})
}

func truncateTraceText(s string, maxRunes int) string {
	s = strings.TrimSpace(s)
	if s == "" || maxRunes <= 0 {
		return ""
	}
	runes := []rune(s)
	if len(runes) <= maxRunes {
		return s
	}
	return string(runes[:maxRunes]) + "…"
}

// AgentRunner is the multi-turn tool loop both adapters implement. The model
// answers by calling finish, whose arguments are validated against its schema.
type AgentRunner interface {
	RunAgent(ctx context.Context, system, user string, tools []AgentTool, finish Tool,
		maxTurns int) (*AgentRun, error)
}

// executeAgentTool runs one tool and returns the JSON returned to the model.
// Tool failures become readable error results rather than aborting the run, so
// the model can correct course.
func executeAgentTool(ctx context.Context, tools []AgentTool, name, args string) (string, bool) {
	var tool *AgentTool
	for i := range tools {
		if tools[i].Name == name {
			tool = &tools[i]
			break
		}
	}
	if tool == nil {
		return errorJSON("unknown tool: " + name), true
	}
	if tool.Run == nil {
		return errorJSON("tool has no implementation: " + name), true
	}
	raw := json.RawMessage(args)
	if len(raw) == 0 {
		raw = json.RawMessage("{}")
	}
	value, err := tool.Run(ctx, raw)
	if err != nil {
		return errorJSON(err.Error()), true
	}
	encoded, err := json.Marshal(value)
	if err != nil {
		return errorJSON(err.Error()), true
	}
	return string(encoded), false
}

func errorJSON(message string) string {
	encoded, _ := json.Marshal(map[string]string{"error": message})
	return string(encoded)
}
