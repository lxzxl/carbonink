package store

import (
	"crypto/rand"
	"encoding/base32"
)

var crockford = base32.NewEncoding("0123456789ABCDEFGHJKMNPQRSTVWXYZ").WithPadding(base32.NoPadding)

func randRead(p []byte) (int, error) { return rand.Read(p) }
