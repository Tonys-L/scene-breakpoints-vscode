package main

type Calculator struct {
	Precision int
}

func (c *Calculator) Multiply(x float64, y float64) float64 {
	result := x * y
	return result
}
