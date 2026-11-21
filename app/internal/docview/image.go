package docview

import (
	"bytes"
	"image"
	"image/draw"

	_ "image/jpeg"
	_ "image/png"

	_ "golang.org/x/image/webp"
)

// DecodeImage reads a PNG, JPEG, or WebP into the premultiplied form the UI
// displays directly.
func DecodeImage(data []byte) (*image.RGBA, error) {
	src, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		return nil, err
	}
	return toRGBA(src), nil
}

func toRGBA(src image.Image) *image.RGBA {
	if rgba, ok := src.(*image.RGBA); ok {
		return rgba
	}
	return copyRGBA(src)
}

// copyRGBA detaches src's pixels from their backing memory. PDFium renders
// into WebAssembly memory that its Cleanup frees, so those frames must be
// copied before the render is released.
func copyRGBA(src image.Image) *image.RGBA {
	bounds := src.Bounds()
	dst := image.NewRGBA(image.Rect(0, 0, bounds.Dx(), bounds.Dy()))
	draw.Draw(dst, dst.Bounds(), src, bounds.Min, draw.Src)
	return dst
}
