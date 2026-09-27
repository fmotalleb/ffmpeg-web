package server

import (
	"net/http"
	"strconv"

	"github.com/fmotalleb/ffmpeg-web/system"
)

// handleKillFfmpeg stops one ffmpeg or ffprobe process, identified by the pid
// the hardware report shows. Only a pid the machine currently reports as an
// ffmpeg is accepted, so this cannot be used as a generic kill switch.
func (s *server) handleKillFfmpeg(w http.ResponseWriter, r *http.Request) {
	pid, err := strconv.Atoi(r.PathValue("pid"))
	if err != nil || pid <= 0 {
		writeErr(w, http.StatusBadRequest, "bad pid")
		return
	}
	if err := system.KillFFmpeg(pid, s.jobs.FfmpegPIDs()); err != nil {
		writeErr(w, http.StatusConflict, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// handleKillAllFfmpeg stops every ffmpeg and ffprobe process on the machine and
// reports how many went down.
func (s *server) handleKillAllFfmpeg(w http.ResponseWriter, r *http.Request) {
	killed, err := system.KillAllFFmpeg(s.jobs.FfmpegPIDs())
	if err != nil && killed == 0 {
		writeErr(w, http.StatusConflict, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"killed": killed})
}
