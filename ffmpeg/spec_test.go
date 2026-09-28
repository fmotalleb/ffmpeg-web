package ffmpeg

import (
	"slices"
	"testing"
)

// A trimmed run has to seek every input to the same point and cap the length
// only after the last input: an -ss or -t sitting next to an added file makes
// ffmpeg read it as that file's input option, which drops the trim end and
// leaves the added track on the source's own timeline.
func TestBuildArgsTrimPlacement(t *testing.T) {
	spec := Spec{
		Container: "mkv",
		Video:     VideoSpec{Encoder: "copy"},
		Audio:     AudioSpec{Encoder: "copy"},
		Subtitle: SubtitleSpec{
			Mode:  "copy",
			Extra: []AddedTrack{{Path: "/media/subs.srt"}},
		},
		Trim: TrimSpec{Enabled: true, Start: 1858, End: 1860},
	}

	args, err := BuildArgs(spec, "/media/movie.mkv", "/media/out.mkv", "", 0)
	if err != nil {
		t.Fatalf("BuildArgs: %v", err)
	}

	inputs := []int{}
	for i, a := range args {
		if a == "-i" {
			inputs = append(inputs, i)
		}
	}
	if len(inputs) != 2 {
		t.Fatalf("expected 2 inputs, got %d in %v", len(inputs), args)
	}
	lastInput := inputs[len(inputs)-1]

	// Every input carries the seek, and nothing else does.
	for _, idx := range inputs {
		if idx < 2 || args[idx-2] != "-ss" || args[idx-1] != "1858" {
			t.Fatalf("input at %d is not seeked to the trim start: %v", idx, args)
		}
	}

	// The trim length belongs after the last input, never between two of them.
	tPos := slices.Index(args, "-t")
	if tPos < 0 {
		t.Fatalf("no trim length in %v", args)
	}
	if tPos < lastInput {
		t.Fatalf("-t sits before the last input, so it limits that input instead: %v", args)
	}
	if got := args[tPos+1]; got != "2" {
		t.Fatalf("trim length = %q, want 2", got)
	}
	if output := args[len(args)-1]; output != "/media/out.mkv" {
		t.Fatalf("output = %q, want the output last", output)
	}
}

// Trimming the end only (a start of zero) still has to cap the output.
func TestBuildArgsTrimEndOnly(t *testing.T) {
	spec := Spec{
		Container: "mkv",
		Video:     VideoSpec{Encoder: "copy"},
		Audio:     AudioSpec{Encoder: "none"},
		Trim:      TrimSpec{Enabled: true, End: 30},
	}
	args, err := BuildArgs(spec, "/media/movie.mkv", "/media/out.mkv", "", 0)
	if err != nil {
		t.Fatalf("BuildArgs: %v", err)
	}
	if slices.Contains(args, "-ss") {
		t.Fatalf("unexpected seek in %v", args)
	}
	tPos := slices.Index(args, "-t")
	if tPos < 0 || args[tPos+1] != "30" {
		t.Fatalf("missing trim length in %v", args)
	}
}
