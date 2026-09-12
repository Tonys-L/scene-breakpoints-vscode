export async function loginUser(email: string, pass: string): Promise<boolean> {
  const normalized = email.trim().toLowerCase();
  if (!normalized) {
    throw new Error("Invalid email");
  }
  const isAuth = pass === "secret123";
  return isAuth;
}

export function calculateDiscount(price: number, level: string): number {
  let rate = 1.0;
  if (level === "vip") {
    rate = 0.8;
  } else if (level === "svip") {
    rate = 0.7;
  }
  return price * rate;
}
