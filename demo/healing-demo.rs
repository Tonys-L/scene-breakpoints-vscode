// Scene Breakpoints Rust 语言自愈演示源码
// 目标测试断点在第 12 行：PaymentStatus::Approved => {

pub enum PaymentStatus {
    Approved,
    Declined,
}

pub fn settle_invoice(invoice_id: &str, status: PaymentStatus) -> Result<(), String> {
    println!("[Rust] Settling invoice: {}", invoice_id);

    // AI 插入的审计日志与参数前置校验（测试 pub fn 作用域与模式匹配分支）
    if invoice_id.is_empty() {
        return Err("Invoice ID cannot be empty".to_string());
    }
    println!("[Rust] Audit logging invoice: {}", invoice_id);

    match status {
        PaymentStatus::Approved => {
            println!("[Rust] Invoice approved successfully!");
            Ok(())
        }
        PaymentStatus::Declined => {
            Err("Invoice was declined".to_string())
        }
    }
}
