package jobs

import (
	"encoding/json"
	"sync"
)

// Broker fans queue events out to every connected browser. Slow subscribers
// lose frames rather than stalling the encoder.
type Broker struct {
	mu   sync.RWMutex
	subs map[chan []byte]struct{}
}

// NewBroker creates the fan-out hub the SSE endpoint subscribes to.
func NewBroker() *Broker { return &Broker{subs: map[chan []byte]struct{}{}} }

func (b *Broker) Subscribe() chan []byte {
	ch := make(chan []byte, 64)
	b.mu.Lock()
	b.subs[ch] = struct{}{}
	b.mu.Unlock()
	return ch
}

func (b *Broker) Unsubscribe(ch chan []byte) {
	b.mu.Lock()
	if _, ok := b.subs[ch]; ok {
		delete(b.subs, ch)
		close(ch)
	}
	b.mu.Unlock()
}

func (b *Broker) Publish(event string, payload any) {
	body, err := json.Marshal(payload)
	if err != nil {
		return
	}
	msg := []byte("event: " + event + "\ndata: " + string(body) + "\n\n")
	b.mu.RLock()
	defer b.mu.RUnlock()
	for ch := range b.subs {
		select {
		case ch <- msg:
		default: // slow client: drop the frame rather than stall the encoder
		}
	}
}
