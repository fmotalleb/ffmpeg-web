package ffmpeg

import (
	"fmt"
	"slices"
	"strconv"
	"strings"
	"testing"
)

// TestBuildArgsMultipleTracks verifies that when multiple audio and subtitle
// tracks are selected, explicit stream indices are used in the -map arguments
// rather than relying on ordering or implicit selection.
func TestBuildArgsMultipleTracks(t *testing.T) {
	spec := Spec{
		Container: "mkv",
		Video:     VideoSpec{Encoder: "copy"},
		Audio: AudioSpec{
			Encoder: "copy",
			// Select tracks 0, 2, and 3 explicitly (skipping track 1)
			Tracks: []int{0, 2, 3},
		},
		Subtitle: SubtitleSpec{
			Mode: "copy",
			// Select subtitles 0 and 2 explicitly (skipping subtitle 1)
			Tracks: []int{0, 2},
		},
	}

	args, err := BuildArgs(spec, "/media/movie.mkv", "/media/out.mkv", "", 0)
	if err != nil {
		t.Fatalf("BuildArgs: %v", err)
	}

	// Find all -map arguments for audio streams
	var audioMaps, subMaps []string
	for i, a := range args {
		if a == "-map" && i+1 < len(args) {
			mapArg := args[i+1]
			if slices.Contains([]string{"a", "s"}, func() string {
				// Extract the stream type from "0:a:0?" or "0:s:0?"
				if strings.Contains(mapArg, ":a:") {
					return "a"
				}
				if strings.Contains(mapArg, ":s:") {
					return "s"
				}
				return ""
			}()) {
				switch {
				case strings.Contains(mapArg, ":a:"):
					audioMaps = append(audioMaps, mapArg)
				case strings.Contains(mapArg, ":s:"):
					subMaps = append(subMaps, mapArg)
				}
			}
		}
	}

	// Verify we have the correct number of audio maps
	if len(audioMaps) != 3 {
		t.Fatalf("expected 3 audio maps, got %d: %v", len(audioMaps), audioMaps)
	}

	// Verify each audio map uses an explicit index from our selection
	expectedAudioIndices := []int{0, 2, 3}
	for _, idx := range expectedAudioIndices {
		found := false
		for _, mapArg := range audioMaps {
			if strings.Contains(mapArg, fmt.Sprintf(":a:%d?", idx)) {
				found = true
				break
			}
		}
		if !found {
			t.Errorf("expected explicit audio map for stream %d, got %v", idx, audioMaps)
		}
	}

	// Verify we have the correct number of subtitle maps
	if len(subMaps) != 2 {
		t.Fatalf("expected 2 subtitle maps, got %d: %v", len(subMaps), subMaps)
	}

	// Verify each subtitle map uses an explicit index from our selection
	expectedSubIndices := []int{0, 2}
	for _, idx := range expectedSubIndices {
		found := false
		for _, mapArg := range subMaps {
			if strings.Contains(mapArg, fmt.Sprintf(":s:%d?", idx)) {
				found = true
				break
			}
		}
		if !found {
			t.Errorf("expected explicit subtitle map for stream %d, got %v", idx, subMaps)
		}
	}
}

// TestBuildArgsTrackSelectionOrder verifies that tracks are mapped in the order
// they appear in the Tracks list, not in stream index order. This ensures we
// respect the user's selection order when it matters.
func TestBuildArgsTrackSelectionOrder(t *testing.T) {
	spec := Spec{
		Container: "mkv",
		Video:     VideoSpec{Encoder: "copy"},
		Audio: AudioSpec{
			Encoder: "copy",
			// Select tracks in non-sorted order: 3, then 0, then 2
			Tracks: []int{3, 0, 2},
		},
	}

	args, err := BuildArgs(spec, "/media/movie.mkv", "/media/out.mkv", "", 0)
	if err != nil {
		t.Fatalf("BuildArgs: %v", err)
	}

	// Extract audio map indices in order
	var audioIndices []int
	for i, a := range args {
		if a == "-map" && i+1 < len(args) {
			mapArg := args[i+1]
			if strings.Contains(mapArg, ":a:") {
				// Extract the index from "0:a:3?"
				parts := strings.Split(mapArg, ":")
				if len(parts) >= 3 {
					idxStr := strings.TrimSuffix(parts[2], "?")
					idx, err := strconv.Atoi(idxStr)
					if err == nil {
						audioIndices = append(audioIndices, idx)
					}
				}
			}
		}
	}

	// Verify the order matches the Tracks list order
	expectedOrder := []int{3, 0, 2}
	if len(audioIndices) != len(expectedOrder) {
		t.Fatalf("expected %d audio maps, got %d: %v", len(expectedOrder), len(audioIndices), audioIndices)
	}
	for i, expected := range expectedOrder {
		if audioIndices[i] != expected {
			t.Errorf("audio map %d: expected stream %d, got %d (maps: %v)", i, expected, audioIndices[i], audioIndices)
		}
	}
}

// TestBuildArgsNoTracksSelected verifies that when no tracks are selected
// (empty Tracks list), no audio or subtitle streams are mapped.
func TestBuildArgsNoTracksSelected(t *testing.T) {
	spec := Spec{
		Container: "mkv",
		Video:     VideoSpec{Encoder: "copy"},
		Audio:     AudioSpec{Encoder: "copy", Tracks: []int{}},
		Subtitle:  SubtitleSpec{Mode: "copy", Tracks: []int{}},
	}

	args, err := BuildArgs(spec, "/media/movie.mkv", "/media/out.mkv", "", 0)
	if err != nil {
		t.Fatalf("BuildArgs: %v", err)
	}

	// Verify no audio or subtitle maps exist
	for _, a := range args {
		if strings.Contains(a, ":a:") || strings.Contains(a, ":s:") {
			t.Errorf("unexpected stream map found when no tracks selected: %s", a)
		}
	}
}
