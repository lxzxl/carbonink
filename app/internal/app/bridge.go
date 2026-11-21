package app

import (
	"app.carbonink.desktop/internal/agentbridge"

	"github.com/nsgo-dev/nsgo/core"
)

// startBridge opens the local socket the MCP helper uses for the three
// allowlisted writes. A failure is logged but never blocks the app: reads
// still work with the app closed, and writes simply report that the bridge is
// unavailable.
func (s *Session) startBridge(cx *core.Scope) {
	handlers := &agentbridge.Handlers{
		Store: s.db,
		OnWrite: func() {
			if s.dataRev == nil {
				return
			}
			s.scope.Post(func() {
				if err := dataRefresh(s, s.dataRev); err != nil {
					s.log.Warn("refresh after agent write failed", "err", err)
				}
			})
		},
	}
	server, err := agentbridge.Listen(agentbridge.Address(cx.DataDir()), handlers.Dispatch)
	if err != nil {
		s.log.Warn("agent bridge unavailable", "err", err)
		return
	}
	s.bridge = server
	s.log.Info("agent bridge listening", "address", server.Address())
}

func (s *Session) stopBridge() {
	if s.bridge == nil {
		return
	}
	if err := s.bridge.Close(); err != nil {
		s.log.Warn("agent bridge close failed", "err", err)
	}
	s.bridge = nil
}
