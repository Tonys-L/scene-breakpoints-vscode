/**
 * Scene Breakpoints 代码行号自愈能力演示源码
 * 预设断点目标语句：if (order.amount <= 0) {
 */

export interface OrderInfo {
	id: string;
	customer: string;
	amount: number;
}

export function processOrderPayment(order: OrderInfo): { success: boolean; message: string } {
	console.log(`[Order] Preparing to process payment for order ${order.id}`);
	console.log(`[Order] Customer name: ${order.customer}`);

	if (order.amount <= 0) {
		throw new Error("Invalid order payment amount!");
	}

	const transactionId = `TX-${Date.now()}`;
	console.log(`[Order] Payment successful! Transaction: ${transactionId}`);

	return {
		success: true,
		message: `Transaction ${transactionId} confirmed`,
	};
}
