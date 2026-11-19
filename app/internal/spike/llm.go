package spike

import (
	"context"
	"encoding/json"
	"strings"
	"time"

	"app.carbonink.desktop/internal/llm"

	"github.com/nsgo-dev/nsgo/core"
	"github.com/nsgo-dev/nsgo/ui"
)

const llmKeyAccount = "llm.openai.apikey"

var activityTool = llm.Tool{
	Name:        "save_activity",
	Description: "Save one extracted activity row from an invoice or receipt. Call this once with the values you read.",
	Schema: json.RawMessage(`{
	  "type":"object",
	  "required":["date","amount","unit","category"],
	  "properties":{
	    "date":{"type":"string","description":"ISO date, YYYY-MM-DD"},
	    "amount":{"type":"number","minimum":0},
	    "unit":{"type":"string","enum":["kWh","L","t","kg","t·km","night"]},
	    "category":{"type":"string","enum":["Cat 1","Cat 2","Cat 3","Cat 4","Cat 6","Cat 12"]},
	    "supplier":{"type":"string"},
	    "note":{"type":"string"}
	  },
	  "additionalProperties":false
	}`),
}

const sampleInvoice = `上海市电力公司 电费发票
客户：示例制造（上海）有限公司
期间：2025-03-01 至 2025-03-31
用电量：128,400 kWh
金额：¥ 96,300.00
税率：13%
发票号码：3100250312`

func llmScreen(cx *core.Scope) core.Node {
	baseURL := core.NewSignal(cx, "https://api.openai.com/v1")
	model := core.NewSignal(cx, "gpt-4o-mini")
	key := core.NewSignal(cx, "")
	output := core.NewSignal(cx, "")
	status := core.NewSignal(cx, "")
	running := core.NewSignal(cx, false)
	secrets := cx.Secrets()

	// The keychain may block, so read it off the engine goroutine.
	go func() {
		v, ok, err := secrets.Get(llmKeyAccount)
		cx.Post(func() {
			if err == nil && ok {
				key.Set(v)
				status.Set("key loaded from the OS secret store")
			}
		})
	}()

	run := func() {
		if running.Get() {
			return
		}
		if key.Get() == "" {
			status.Set("enter an API key first")
			return
		}
		running.Set(true)
		output.Set("")
		status.Set("streaming…")
		k, base, m := key.Get(), baseURL.Get(), model.Get()
		go func() {
			_ = secrets.Set(llmKeyAccount, k)
			ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
			defer cancel()
			client := &llm.Client{BaseURL: base, APIKey: k, Model: m}
			events, err := client.Stream(ctx, "You extract one activity row. Call save_activity with the values.", sampleInvoice, []llm.Tool{activityTool})
			if err != nil {
				cx.Post(func() { status.Set("failed: " + err.Error()); running.Set(false) })
				return
			}
			var text strings.Builder
			for ev := range events {
				switch {
				case ev.Err != nil:
					e := ev.Err
					cx.Post(func() { status.Set("failed: " + e.Error()); running.Set(false) })
					return
				case ev.Text != "":
					text.WriteString(ev.Text)
					s := text.String()
					cx.Post(func() { output.Set(s) })
				case ev.Tool != nil:
					args := ev.Tool.Arguments
					cx.Post(func() {
						if err := llm.Validate(activityTool.Schema, []byte(args)); err != nil {
							status.Set("tool call rejected: " + err.Error())
						} else {
							status.Set("tool call validated · " + ev.Tool.Name)
							output.Set(prettyJSON(args))
						}
						running.Set(false)
					})
				}
			}
			cx.Post(func() {
				if status.Get() == "streaming…" {
					status.Set("done")
				}
				running.Set(false)
			})
		}()
	}

	field := func(title string, in ui.Input) core.Node {
		return core.View{Style: core.Style{Gap: 4}, Children: []core.Node{
			core.Text{Content: title, Style: core.Style{FontSize: 12, FontWeight: ui.Medium},
				StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted)},
			in,
		}}
	}

	return panel(cx,
		card(cx,
			label(cx, "Provider"),
			core.View{Style: core.Style{Direction: core.Row, Gap: 8}, Children: []core.Node{
				core.View{Style: core.Style{FlexGrow: 3}, Children: []core.Node{
					field("Base URL", ui.Input{Value: baseURL.Get, OnChange: baseURL.Set, Placeholder: "https://api.openai.com/v1"})}},
				core.View{Style: core.Style{FlexGrow: 1}, Children: []core.Node{
					field("Model", ui.Input{Value: model.Get, OnChange: model.Set})}},
			}},
			field("API key (kept in cx.Secrets)", ui.Input{Value: key.Get, OnChange: key.Set, Masked: true,
				Placeholder: "sk-…"}),
			core.View{Style: core.Style{Direction: core.Row, Gap: 8}, Children: []core.Node{
				ui.Button{Text: "Run extraction", OnPress: run, Busy: running.Get},
				ui.Button{Text: "Forget key", Variant: ui.ButtonGhost, OnPress: func() {
					go func() {
						_ = secrets.Delete(llmKeyAccount)
						cx.Post(func() { key.Set(""); status.Set("key removed") })
					}()
				}},
				core.Text{ContentFunc: status.Get, Style: core.Style{FontSize: 12},
					StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted)},
			}},
		),
		card(cx,
			label(cx, "Input"),
			core.Text{Content: sampleInvoice, Style: core.Style{FontSize: 12, FontFamily: "monospace"}},
		),
		card(cx,
			label(cx, "Output"),
			core.Text{ContentFunc: func() string {
				if output.Get() == "" {
					return "Run against any OpenAI-compatible endpoint, or run the Go tests: they cover streaming, split tool-call arguments and schema rejection without a key."
				}
				return output.Get()
			}, Style: core.Style{FontSize: 12, FontFamily: "monospace"}},
		),
	)
}

func prettyJSON(s string) string {
	var v any
	if json.Unmarshal([]byte(s), &v) != nil {
		return s
	}
	b, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		return s
	}
	return string(b)
}
