//go:build !windows && !linux

package keepawake

import "errors"

// platformHold has no implementation on this platform. The caller logs the
// error once and continues without holding the machine awake.
func platformHold() (func(), error) {
	return nil, errors.New("keep-awake is not supported on this platform")
}
