package main

import (
	"fmt"
)

type OrderService struct{}

// 目标测试断点在第 14 行：if err := s.validate(amount); err != nil {
func (s *OrderService) ExecutePayment(orderId string, amount float64) error {
	fmt.Printf("[Go] Processing payment for %s\n", orderId)
	fmt.Printf("[Go] Order amount: %.2f\n", amount)

	// AI 插入的链路追踪和空订单号前置校验（测试结构体 Receiver 作用域与 if 干扰）
	traceId := "TRACE-" + orderId
	fmt.Printf("[Go] Trace ID: %s\n", traceId)
	if orderId == "" {
		return fmt.Errorf("order id cannot be empty")
	}

	if err := s.validate(amount); err != nil {
		return fmt.Errorf("payment validation failed: %w", err)
	}

	fmt.Printf("[Go] Payment successful!\n")
	return nil
}

func (s *OrderService) validate(amount float64) error {
	if amount <= 0 {
		return fmt.Errorf("amount must be positive")
	}
	return nil
}
