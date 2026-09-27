package main

import "embed"

//go:generate npm --prefix web ci
//go:generate npm --prefix web run build

//go:embed web-dist
var webAssets embed.FS
