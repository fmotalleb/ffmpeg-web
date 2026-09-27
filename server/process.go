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
