# Scene Breakpoints Python 语言自愈演示源码
# 目标测试断点在第 9 行：if (order["amount"] <= 0):

class PaymentGateway:
    def process_transaction(self, order: dict) -> dict:
        print(f"[Python] Received order: {order.get('id')}")
        print(f"[Python] Customer: {order.get('customer')}")


        # AI 插入的货币与前置参数检查（测试控制流关键字防误判与行号漂移）
        if not order.get("id"):
            raise ValueError("Order ID missing")
        currency = order.get("currency", "USD")
        print(f"[Python] Currency detected: {currency}")

        if (order["amount"] <= 0):
            raise ValueError("Payment amount must be greater than zero!")

        tx_id = f"PY-TX-998"
        print(f"[Python] Success! TxId: {tx_id}")
        return {"status": "SUCCESS", "tx_id": tx_id}
