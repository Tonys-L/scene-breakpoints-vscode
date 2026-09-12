class OrderService:
    def __init__(self, db_client):
        self.db = db_client

    def process_payment(self, order_id, amount):
        if amount <= 0:
            raise ValueError("Invalid amount")
        status = "paid"
        return status

    def cancel_order(self, order_id):
        status = "cancelled"
        return status
