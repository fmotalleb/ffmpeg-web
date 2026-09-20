package main

import (
	"encoding/json"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"sync"
	"time"
)

const snapshotVersion = 1

// Snapshot is everything that has to survive a restart.
type Snapshot struct {
	Version  int           `json:"version"`
	SavedAt  time.Time     `json:"savedAt"`
	Paused   bool          `json:"paused"`
	Settings QueueSettings `json:"settings"`
	Jobs     []Job         `json:"jobs"`
	Order    []string      `json:"order"`
}

// QueueSettings are the queue-wide switches the UI exposes.
type QueueSettings struct {
	VerifyOutput     bool    `json:"verifyOutput"`
	AutoDeleteSource bool    `json:"autoDeleteSource"`
	ShrinkThreshold  float64 `json:"shrinkThreshold"` // percent the file must shrink by
	PostQueue        Hook    `json:"postQueue"`
}

type Hook struct {
	Type    string `json:"type"` // none | command | webhook
	Command string `json:"command"`
	URL     string `json:"url"`
}

func defaultSettings() QueueSettings {
	return QueueSettings{
		VerifyOutput:    true,
		ShrinkThreshold: 20,
		PostQueue:       Hook{Type: "none"},
	}
}

// Store writes the queue to one JSON file. Writes are coalesced so a busy
// encode does not hammer the disk, and are atomic so a crash mid-write cannot
// leave a half-written queue behind.
type Store struct {
	path  string
	mu    sync.Mutex
	dirty bool
	next  func() Snapshot
}

func NewStore(path string) *Store { return &Store{path: path} }

// Start begins the flush loop. snapshot is called whenever a write is due.
func (s *Store) Start(snapshot func() Snapshot) {
	s.next = snapshot
	go func() {
		tick := time.NewTicker(700 * time.Millisecond)
		defer tick.Stop()
		for range tick.C {
			s.mu.Lock()
			due := s.dirty
			s.dirty = false
			s.mu.Unlock()
			if due {
				if err := s.write(s.next()); err != nil {
					log.Printf("could not save the queue: %v", err)
				}
			}
		}
	}()
}

func (s *Store) Touch() {
	s.mu.Lock()
	s.dirty = true
	s.mu.Unlock()
}

// Flush writes immediately, for shutdown.
func (s *Store) Flush() {
	if s.next == nil {
		return
	}
	if err := s.write(s.next()); err != nil {
		log.Printf("could not save the queue: %v", err)
	}
}

func (s *Store) write(snap Snapshot) error {
	snap.Version = snapshotVersion
	snap.SavedAt = time.Now()
	body, err := json.MarshalIndent(snap, "", "  ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(s.path), 0o755); err != nil {
		return err
	}
	tmp := s.path + ".tmp"
	if err := os.WriteFile(tmp, body, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, s.path)
}

func (s *Store) Load() (Snapshot, error) {
	var snap Snapshot
	body, err := os.ReadFile(s.path)
	if os.IsNotExist(err) {
		return Snapshot{Settings: defaultSettings(), Paused: false}, nil
	}
	if err != nil {
		return snap, err
	}
	if err := json.Unmarshal(body, &snap); err != nil {
		// A damaged queue file should not stop the server from starting.
		backup := fmt.Sprintf("%s.broken-%d", s.path, time.Now().Unix())
		_ = os.Rename(s.path, backup)
		log.Printf("queue file was unreadable, moved it to %s", backup)
		return Snapshot{Settings: defaultSettings()}, nil
	}
	if snap.Settings.ShrinkThreshold == 0 {
		snap.Settings.ShrinkThreshold = 20
	}
	if snap.Settings.PostQueue.Type == "" {
		snap.Settings.PostQueue.Type = "none"
	}
	return snap, nil
}
