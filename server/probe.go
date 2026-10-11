package server

import (
	"net/http"

	"github.com/fmotalleb/ffmpeg-web/probe"
)

func (s *server) handleProbe(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Path string `json:"path"`
	}
	if err := decodeBody(r, &body); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	path, err := s.allowedPath(body.Path)
	if err != nil {
		writeErr(w, http.StatusForbidden, err.Error())
		return
	}
	info, err := probe.Probe(r.Context(), s.ffprobe, path)
	if err != nil {
		writeErr(w, http.StatusUnprocessableEntity, err.Error())
		return
	}
	if info.Video == nil {
		writeErr(w, http.StatusUnprocessableEntity, "no video track in this file")
		return
	}
	writeJSON(w, http.StatusOK, info)
}

// handleProbeRaw returns the complete ffprobe report for a source file.
func (s *server) handleProbeRaw(w http.ResponseWriter, r *http.Request) {
	path, err := s.allowedPath(r.URL.Query().Get("path"))
	if err != nil {
		writeErr(w, http.StatusForbidden, err.Error())
		return
	}
	s.serveRawProbe(w, r, path)
}

// handleJobProbe reports on either side of a job: ?which=source or output.
func (s *server) handleJobProbe(w http.ResponseWriter, r *http.Request) {
	job, ok := s.jobs.Get(r.PathValue("id"))
	if !ok {
		writeErr(w, http.StatusNotFound, "no such job")
		return
	}
	path := job.Source
	if r.URL.Query().Get("which") == "output" {
		path = job.Output
		if err := s.outputAccessible(path); err != nil {
			writeErr(w, http.StatusForbidden, err.Error())
			return
		}
	} else if _, err := s.allowedPath(path); err != nil {
		writeErr(w, http.StatusForbidden, err.Error())
		return
	}
	s.serveRawProbe(w, r, path)
}

func (s *server) serveRawProbe(w http.ResponseWriter, r *http.Request, path string) {
	raw, err := probe.Raw(r.Context(), s.ffprobe, path)
	if err != nil {
		writeErr(w, http.StatusUnprocessableEntity, err.Error())
		return
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	_, _ = w.Write(raw)
}
