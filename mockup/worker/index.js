const PRODUCTS = [
  {id:"p001",name:"Wireless Headphones",price:1290},
  {id:"p002",name:"Minimal Keyboard",price:1890},
  {id:"p003",name:"Studio Desk Lamp",price:790},
  {id:"p004",name:"Everyday Backpack",price:1590},
  {id:"p005",name:"USB-C Hub",price:990},
  {id:"p006",name:"Portable Speaker",price:1490}
];

const json = (data,status=200,origin="") => new Response(
  JSON.stringify(data),
  {status,headers:{
    "Content-Type":"application/json; charset=utf-8",
    "Cache-Control":"no-store",
    "Access-Control-Allow-Origin":origin,
    "Access-Control-Allow-Methods":"POST, OPTIONS",
    "Access-Control-Allow-Headers":"Content-Type"
  }}
);

function clean(value,max) {
  return typeof value === "string"
    ? value.trim().slice(0,max)
    : "";
}

export default {
  async fetch(request,env) {
    const origin = request.headers.get("Origin") || "";
    const allowedOrigin = env.ALLOWED_ORIGIN || "";

    if (origin !== allowedOrigin) {
      return json({ok:false,error:"Origin not allowed"},403,allowedOrigin);
    }

    if (request.method === "OPTIONS") {
      return new Response(null,{status:204,headers:{
        "Access-Control-Allow-Origin":allowedOrigin,
        "Access-Control-Allow-Methods":"POST, OPTIONS",
        "Access-Control-Allow-Headers":"Content-Type",
        "Vary":"Origin"
      }});
    }

    const url = new URL(request.url);
    if (url.pathname === "/health" && request.method === "GET") {
      return json({ok:true},200,allowedOrigin);
    }

    if (url.pathname !== "/api/orders" || request.method !== "POST") {
      return json({ok:false,error:"Not found"},404,allowedOrigin);
    }

    if (!env.DISCORD_WEBHOOK_URL) {
      return json({ok:false,error:"Server configuration error"},500,allowedOrigin);
    }

    try {
      const length = Number(request.headers.get("Content-Length") || 0);
      if (length > 20000) {
        return json({ok:false,error:"Request too large"},413,allowedOrigin);
      }

      const body = await request.json();
      const customer = body.customer || {};

      const name = clean(customer.name,100);
      const phone = clean(customer.phone,20);
      const address = clean(customer.address,500);
      const note = clean(customer.note,300);

      if (!name || !phone || !address) {
        return json({ok:false,error:"กรุณากรอกข้อมูลผู้ซื้อให้ครบ"},400,allowedOrigin);
      }

      if (!/^[0-9+() -]{9,20}$/.test(phone)) {
        return json({ok:false,error:"เบอร์โทรศัพท์ไม่ถูกต้อง"},400,allowedOrigin);
      }

      if (body.paymentMethod !== "COD") {
        return json({ok:false,error:"Payment method not supported"},400,allowedOrigin);
      }

      if (!Array.isArray(body.items) || body.items.length < 1 || body.items.length > 20) {
        return json({ok:false,error:"รายการสินค้าไม่ถูกต้อง"},400,allowedOrigin);
      }

      const items = [];
      const seen = new Set();

      for (const item of body.items) {
        const product = PRODUCTS.find(p => p.id === item.id);
        const qty = item.quantity;

        if (!product || !Number.isInteger(qty) || qty < 1 || qty > 20 || seen.has(item.id)) {
          return json({ok:false,error:"ข้อมูลสินค้าไม่ถูกต้อง"},400,allowedOrigin);
        }

        seen.add(item.id);
        items.push({...product,quantity:qty,subtotal:product.price*qty});
      }

      const total = items.reduce((sum,item) => sum+item.subtotal,0);
      const orderId = "RYU-" + Date.now().toString(36).toUpperCase();

      const discordPayload = {
        username:"RYU STORE Orders",
        allowed_mentions:{parse:[]},
        embeds:[{
          title:"🛍️ คำสั่งซื้อใหม่",
          color:0xFFFFFF,
          description:`**Order ID:** \`${orderId}\`\n**สถานะ:** รอยืนยันคำสั่งซื้อ`,
          fields:[
            {name:"ผู้รับ",value:name.slice(0,100),inline:true},
            {name:"เบอร์โทร",value:phone,inline:true},
            {name:"ที่อยู่จัดส่ง",value:address.slice(0,1000)},
            {name:"รายการสินค้า",value:items.map(i=>
              `• ${i.name} × ${i.quantity} — ฿${i.subtotal.toLocaleString("en-US")}`
            ).join("\n").slice(0,1024)},
            {name:"วิธีชำระเงิน",value:"เก็บเงินปลายทาง (COD)",inline:true},
            {name:"ยอดรวมสินค้า",value:`฿${total.toLocaleString("en-US")}`,inline:true},
            ...(note ? [{name:"หมายเหตุ",value:note.slice(0,500)}] : [])
          ],
          timestamp:new Date().toISOString(),
          footer:{text:"RYU STORE · Demo Order"}
        }]
      };

      const discord = await fetch(env.DISCORD_WEBHOOK_URL,{
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify(discordPayload)
      });

      if (!discord.ok) {
        console.error("Discord webhook failed",discord.status);
        return json({ok:false,error:"ส่งแจ้งเตือนร้านค้าไม่สำเร็จ กรุณาลองใหม่"},502,allowedOrigin);
      }

      return json({ok:true,orderId},200,allowedOrigin);
    } catch(error) {
      console.error("Order handler error",error);
      return json({ok:false,error:"ข้อมูลไม่ถูกต้องหรือระบบขัดข้อง"},400,allowedOrigin);
    }
  }
};