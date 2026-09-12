// ============================================================================
// 🚀 Scene Breakpoints 断点全类型实测演示脚本 (Demo)
// ============================================================================

/**
 * 模拟核心支付处理函数（用于测试【函数断点】）
 */
function executeFinalPayment(orderId, amount) {
  console.log(`\n💳 [Payment Gateway] 正在执行扣款: 订单号=${orderId}, 金额=¥${amount}`);
  return { success: true, transactionId: `TX_${Date.now()}` };
}

/**
 * 订单结算处理主流程
 */
async function processOrderCheckout(order) {
  console.log(`\n========================================`);
  console.log(`📦 [Order Processing] 开始处理订单: ${order.id}`);
  console.log(`========================================`);

  // [断点 1: 普通行断点] -> 拦截订单入口
  const orderUser = order.user;
  let totalAmount = 0;

  // [断点 2: 条件断点] -> 仅在 order.vipLevel === "SVIP" 时停下
  if (order.vipLevel === "SVIP") {
    console.log(`👑 [VIP Perk] 检测到至尊黑金会员 (${orderUser})，应用专属 7 折特惠`);
    order.discountRate = 0.7;
  } else {
    order.discountRate = 1.0;
  }

  console.log(`\n🛒 开始核算商品清单 (共 ${order.items.length} 件):`);
  for (let i = 0; i < order.items.length; i++) {
    const item = order.items[i];

    // [断点 3: 日志断点 Logpoint] -> 打印商品信息，不暂停执行
    const subtotal = item.price * item.quantity;

    // [断点 4: 命中计数断点 Hit Count] -> 命中次数 > 2 时停下 (第 3 件商品起停下)
    totalAmount += subtotal;
    console.log(`   - 商品 ${i + 1}/${order.items.length}: ${item.name} x ${item.quantity} = ¥${subtotal}`);
  }

  // 计算折扣后总价
  const finalPrice = totalAmount * order.discountRate;
  console.log(`📊 订单金额核算完成: 原价=¥${totalAmount}, 实付=¥${finalPrice}`);

  // [断点 5: 函数断点] -> 调用 executeFinalPayment 时自动在函数第 9 行入口暂停
  const paymentResult = executeFinalPayment(order.id, finalPrice);
  console.log(`✅ [Complete] 订单处理完毕，交易凭据: ${paymentResult.transactionId}\n`);
}

/**
 * 模拟主运行入口
 */
async function main() {
  console.log("🌟 Scene Breakpoints 演示程序已启动！按 F5 正在全自动运行...\n");

  // 订单 1: 普通用户订单（3 件商品）
  await processOrderCheckout({
    id: "ORD_NORMAL_1001",
    user: "张小明 (普通会员)",
    vipLevel: "NORMAL",
    items: [
      { name: "机械键盘", price: 399, quantity: 1 },
      { name: "降噪耳机", price: 899, quantity: 1 },
      { name: "人体工学鼠标", price: 299, quantity: 1 },
    ],
  });

  // 订单 2: SVIP 会员订单（4 件商品，触发条件断点与多次命中断点）
  await processOrderCheckout({
    id: "ORD_VIP_8888",
    user: "李大伟 (至尊黑金会员)",
    vipLevel: "SVIP",
    items: [
      { name: "4K 摄影机", price: 12800, quantity: 1 },
      { name: "防抖云台", price: 2500, quantity: 1 },
      { name: "补光灯组", price: 1200, quantity: 2 },
      { name: "专业收音麦克风", price: 1680, quantity: 1 },
    ],
  });

  console.log("🎉 演示程序全部执行结束！");
}

main().catch(console.error);
