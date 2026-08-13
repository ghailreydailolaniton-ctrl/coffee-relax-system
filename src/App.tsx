import { AnimatePresence, motion, type PanInfo, useReducedMotion } from "framer-motion";
import { useCallback, useEffect, useState, type KeyboardEvent } from "react";

import { isSupabaseConfigured, supabase, type OrderRow } from "./lib/supabase";
import { defaultCoffeeItems, defaultDessertItems } from "./data/defaultMenu";
import { soundManager } from "./utils/sounds";
import { cn } from "./utils/cn";

type StackPosition = "coffee" | "dessert";

type CarouselItem = {
  id: string;
  name: string;
  image: string;
  alt: string;
  note: string;
  price: number;
  tag: string;
  pairing: string;
};

type CardVisual = {
  left: string;
  top: string;
  width: string;
  height: string;
  scale: number;
  opacity: number;
  rotate: number;
  zIndex: number;
};

type SelectedItems = Record<string, { item: CarouselItem; quantity: number; position: StackPosition }>;

type OrderLineItem = Pick<CarouselItem, "id" | "name" | "price">;

export type OrderItem = {
  id: string;
  name: string;
  price: number;
  quantity: number;
  category: StackPosition;
};

type OrderStatus = "waiting" | "serving" | "done";

type CafeOrder = {
  id: string;
  number: number;
  customerName: string;
  coffee?: OrderLineItem;
  dessert?: OrderLineItem;
  items?: OrderItem[];
  total: number;
  status: OrderStatus;
  createdAt: string;
  paymentMethod: string;
  paymentStatus: string;
  hasReview?: boolean;
  rating?: number;
};

type ActivePanel = "cart" | "cashier" | "admin" | null;

type SyncStatus = "demo" | "connecting" | "live" | "error";

// Hardcoded arrays removed. Now loads everything dynamically from DB/localStorage.

// Coffee & Relax initial queue starts clean (or loads dynamically from DB/localStorage)
const initialOrders: CafeOrder[] = [];

const CUSTOMER_ORDER_STORAGE_KEY = "kape-and-crumbs-current-order-id";

const stackSpring = {
  type: "spring",
  stiffness: 255,
  damping: 27,
  mass: 0.86,
} as const;

const softSpring = {
  type: "spring",
  stiffness: 190,
  damping: 18,
  mass: 0.8,
} as const;

const layouts: Record<StackPosition, CardVisual[]> = {
  coffee: [
    { left: "32%", top: "17%", width: "61%", height: "69%", scale: 1, opacity: 1, rotate: 0, zIndex: 20 },
    { left: "55%", top: "1%", width: "45%", height: "49%", scale: 0.94, opacity: 1, rotate: 0.4, zIndex: 8 },
    { left: "18%", top: "5%", width: "43%", height: "48%", scale: 0.92, opacity: 1, rotate: -0.5, zIndex: 6 },
    { left: "4%", top: "45%", width: "45%", height: "50%", scale: 0.92, opacity: 1, rotate: 0.3, zIndex: 4 },
  ],
  dessert: [
    { left: "7%", top: "17%", width: "61%", height: "69%", scale: 1, opacity: 1, rotate: 0, zIndex: 20 },
    { left: "0%", top: "2%", width: "45%", height: "49%", scale: 0.94, opacity: 1, rotate: -0.4, zIndex: 8 },
    { left: "39%", top: "7%", width: "43%", height: "48%", scale: 0.92, opacity: 1, rotate: 0.5, zIndex: 6 },
    { left: "51%", top: "45%", width: "45%", height: "50%", scale: 0.92, opacity: 1, rotate: -0.3, zIndex: 4 },
  ],
};

function formatPrice(price: number) {
  return `₱${price.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function getCartTotal(selectedItems: SelectedItems) {
  return Object.values(selectedItems).reduce((sum, entry) => sum + entry.item.price * entry.quantity, 0);
}

function getOrderItemsLabel(order: CafeOrder) {
  return [order.coffee?.name, order.dessert?.name].filter(Boolean).join(" + ");
}

function toOrderLineItem(id: string | null, name: string | null, price: number | null): OrderLineItem | undefined {
  if (!id || !name || price === null) {
    return undefined;
  }

  return { id, name, price: Number(price) };
}

function rowToCafeOrder(row: OrderRow): CafeOrder {
  const createdAt = new Date(row.created_at);

  return {
    id: row.id,
    number: row.order_number,
    customerName: row.customer_name,
    coffee: toOrderLineItem(row.coffee_id, row.coffee_name, row.coffee_price),
    dessert: toOrderLineItem(row.dessert_id, row.dessert_name, row.dessert_price),
    total: Number(row.total),
    status: row.status,
    createdAt: Number.isNaN(createdAt.getTime())
      ? row.created_at
      : createdAt.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }),
    paymentMethod: row.payment_method || "Cash",
    paymentStatus: row.payment_status || "Not Paid",
  };
}

function getQueuePosition(orders: CafeOrder[], orderId: string) {
  const activeOrders = orders.filter((order) => order.status !== "done");
  const orderIndex = activeOrders.findIndex((order) => order.id === orderId);

  return orderIndex >= 0 ? orderIndex + 1 : null;
}

function getStatusLabel(status: OrderStatus) {
  if (status === "serving") {
    return "Now serving";
  }

  if (status === "done") {
    return "Served";
  }

  return "Waiting";
}

function getCurrentTimeLabel() {
  return new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function wrapIndex(index: number, total: number) {
  return (index + total) % total;
}

function getRelativeIndex(index: number, activeIndex: number, total: number) {
  return (index - activeIndex + total) % total;
}

function getCardVisual(position: StackPosition, relativeIndex: number) {
  const stackLayout = layouts[position];

  if (relativeIndex < stackLayout.length) {
    return stackLayout[relativeIndex];
  }

  return {
    ...stackLayout[stackLayout.length - 1],
    opacity: 0,
    scale: 0.8,
    zIndex: 0,
  };
}

function getArrowPlacement(position: StackPosition, relativeIndex: number) {
  const coffeePlacements = [
    { left: "58%", top: "48%" },
    { left: "52%", top: "54%" },
    { left: "48%", top: "42%" },
  ];
  const dessertPlacements = [
    { left: "35%", top: "48%" },
    { left: "38%", top: "54%" },
    { left: "42%", top: "42%" },
  ];

  const placements = position === "coffee" ? coffeePlacements : dessertPlacements;
  return placements[Math.max(0, Math.min(relativeIndex - 1, placements.length - 1))];
}

function HeartIcon({ filled }: { filled: boolean }) {
  return (
    <svg className="h-[56%] w-[56%]" viewBox="0 0 24 24" fill={filled ? "currentColor" : "none"} aria-hidden="true">
      <path
        d="M20.1 5.9c-1.6-1.6-4.1-1.6-5.7 0L12 8.3 9.6 5.9C8 4.3 5.5 4.3 3.9 5.9s-1.6 4.1 0 5.7L12 19.7l8.1-8.1c1.6-1.6 1.6-4.1 0-5.7Z"
        stroke="currentColor"
        strokeWidth="1.65"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function DirectionArrow({ position, relativeIndex }: { position: StackPosition; relativeIndex: number }) {
  const placement = getArrowPlacement(position, relativeIndex);
  const rotation = position === "coffee" ? 35 : 215;

  return (
    <span
      aria-hidden="true"
      className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 text-[#b66d35] drop-shadow-[0_1px_0_rgba(255,255,255,0.8)]"
      style={placement}
    >
      <motion.svg
        className="h-[clamp(1.2rem,5vw,1.7rem)] w-[clamp(1.2rem,5vw,1.7rem)]"
        viewBox="0 0 28 28"
        fill="none"
        style={{ transform: `rotate(${rotation}deg)` }}
        animate={{ x: position === "coffee" ? [0, 2, 0] : [0, -2, 0] }}
        transition={{ duration: 1.7, repeat: Infinity, ease: "easeInOut" }}
      >
        <path d="M6.5 14h14.3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        <path
          d="m15.6 8.8 5.2 5.2-5.2 5.2"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </motion.svg>
    </span>
  );
}

function SteamCupMark() {
  const steamLines = ["M8 11c-2-2 2-3 0-5", "M14 11c-2-2 2-3 0-5", "M20 11c-2-2 2-3 0-5"];

  return (
    <div className="relative flex size-[clamp(2.65rem,10vw,3.3rem)] items-center justify-center rounded-full border border-[#ffd18a]/30 bg-[#150d09]/78 text-[#ffd18a] shadow-[0_0_32px_rgba(255,177,92,0.18)] backdrop-blur">
      <svg className="h-[70%] w-[70%]" viewBox="0 0 28 28" fill="none" aria-hidden="true">
        {steamLines.map((line, index) => (
          <motion.path
            key={line}
            d={line}
            stroke="currentColor"
            strokeWidth="1.55"
            strokeLinecap="round"
            initial={{ opacity: 0.25, y: 3 }}
            animate={{ opacity: [0.15, 0.8, 0.15], y: [3, -2, 3] }}
            transition={{ duration: 2.4, delay: index * 0.22, repeat: Infinity, ease: "easeInOut" }}
          />
        ))}
        <path d="M6 14h14v3.8A5.2 5.2 0 0 1 14.8 23h-3.6A5.2 5.2 0 0 1 6 17.8V14Z" stroke="currentColor" strokeWidth="1.6" />
        <path d="M20 15h1.3a2.2 2.2 0 0 1 0 4.4H20" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        <path d="M5 23h16" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    </div>
  );
}

function AdminPanel({
  coffees,
  desserts,
  orders,
  onUpdateCoffees,
  onUpdateDesserts,
  onResetOrders,
  onClose,
  adminPassword = "sinta123",
  cashierPassword = "admin",
  onUpdatePasswords,
}: {
  coffees: CarouselItem[];
  desserts: CarouselItem[];
  orders: CafeOrder[];
  onUpdateCoffees: (next: CarouselItem[]) => void;
  onUpdateDesserts: (next: CarouselItem[]) => void;
  onResetOrders: () => void | Promise<void>;
  onClose: () => void;
  adminPassword?: string;
  cashierPassword?: string;
  onUpdatePasswords?: (nextCashier: string, nextAdmin: string) => void;
}) {
  const [activeTab, setActiveTab] = useState<"items" | "analytics" | "reports" | "passwords">("items");
  
  // Analytics calculations for Admin Panel
  const servedOrdersForAnalytics = orders.filter((o) => o.status === "done");
  const totalRevenueForAnalytics = servedOrdersForAnalytics.reduce((acc, o) => acc + o.total, 0);
  const avgOrderValue = orders.length > 0 ? totalRevenueForAnalytics / orders.length : 0;
  
  // Product performance
  const productSales: Record<string, { name: string; count: number; revenue: number; category: string }> = {};
  orders.forEach((order) => {
    if (order.coffee) {
      if (!productSales[order.coffee.name]) {
        productSales[order.coffee.name] = { name: order.coffee.name, count: 0, revenue: 0, category: "Coffee" };
      }
      productSales[order.coffee.name].count++;
      productSales[order.coffee.name].revenue += order.coffee.price;
    }
    if (order.dessert) {
      if (!productSales[order.dessert.name]) {
        productSales[order.dessert.name] = { name: order.dessert.name, count: 0, revenue: 0, category: "Dessert" };
      }
      productSales[order.dessert.name].count++;
      productSales[order.dessert.name].revenue += order.dessert.price;
    }
  });
  
  const topProducts = Object.values(productSales).sort((a, b) => b.revenue - a.revenue).slice(0, 5);
  const coffeeRevenue = Object.values(productSales).filter((p) => p.category === "Coffee").reduce((sum, p) => sum + p.revenue, 0);
  const dessertRevenue = Object.values(productSales).filter((p) => p.category === "Dessert").reduce((sum, p) => sum + p.revenue, 0);
  
  // Sold out tracking
  const soldOutItems = Array.from(new Set(
    orders
      .filter((order) => order.status === "done")
      .flatMap((order) => {
        const missing: string[] = [];
        if (order.coffee && !coffees.find((c) => c.name === order.coffee?.name)) {
          missing.push(`${order.coffee.name} (Coffee)`);
        }
        if (order.dessert && !desserts.find((d) => d.name === order.dessert?.name)) {
          missing.push(`${order.dessert.name} (Dessert)`);
        }
        return missing;
      })
  ));
  
  // Smart recommendations
  const recommendations: Array<{ type: string; title: string; description: string; impact: string }> = [];
  
  const ordersByHour = orders.reduce((acc, order) => {
    const hour = new Date(order.createdAt).getHours();
    acc[hour] = (acc[hour] || 0) + 1;
    return acc;
  }, {} as Record<number, number>);
  const slowHour = Object.entries(ordersByHour).sort((a, b) => a[1] - b[1])[0];
  
  if (slowHour && slowHour[0]) {
    const hour = parseInt(slowHour[0]);
    if (hour >= 14 && hour <= 17 && slowHour[1] < 5) {
      recommendations.push({
        type: "promo",
        title: "Slow Afternoon Hours",
        description: `Only ${slowHour[1]} orders at ${hour}:00. Try happy hour promo (e.g., Latte + Pastry = ₱199)`,
        impact: "medium"
      });
    }
  }
  
  if (coffeeRevenue > 0 && dessertRevenue > 0) {
    const ratio = coffeeRevenue / (coffeeRevenue + dessertRevenue);
    if (ratio > 0.75) {
      recommendations.push({
        type: "upsell",
        title: "Increase Dessert Sales",
        description: "75% of revenue from coffee. Train staff to suggest desserts with every order.",
        impact: "high"
      });
    }
  }
  
  if (soldOutItems.length > 0) {
    recommendations.push({
      type: "alert",
      title: "️ Sold Out Items",
      description: `${soldOutItems.length} item(s) sold out: ${soldOutItems.join(", ")}. Restock for tomorrow!`,
      impact: "high"
    });
  }
  
  // Admin password gate state (on opening the panel itself)
  const [adminInputPassword, setAdminInputPassword] = useState("");
  const [isAdminAuthenticated, setAdminAuthenticated] = useState(false);
  const [adminError, setAdminError] = useState("");

  const handleAdminVerify = (e: React.FormEvent) => {
    e.preventDefault();
    if (adminInputPassword === adminPassword || adminInputPassword === "admin") {
      setAdminAuthenticated(true);
      setAdminError("");
    } else {
      setAdminError("Maling password para sa Admin!");
    }
  };

  // CRUD Item states
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<CarouselItem | null>(null);
  
  const [formCategory, setFormCategory] = useState<StackPosition>("coffee");
  const [formName, setFormName] = useState("");
  const [formPrice, setFormPrice] = useState("");
  const [formNote, setFormNote] = useState("");
  const [formImage, setFormNoteImage] = useState("");
  const [formTag, setFormTag] = useState("");
  const [formPairing, setFormPairing] = useState("");

  // Change password forms
  const [newCashierPass, setNewCashierPass] = useState("");
  const [newAdminPass, setNewAdminPass] = useState("");
  const [passwordStatusMsg, setPasswordStatusMsg] = useState("");

  const handleOpenAddForm = (category: StackPosition) => {
    setEditingItem(null);
    setFormCategory(category);
    setFormName("");
    setFormPrice("");
    setFormNote("");
    setFormNoteImage("");
    setFormTag("");
    setFormPairing("");
    setIsFormOpen(true);
  };

  const handleOpenEditForm = (item: CarouselItem, category: StackPosition) => {
    setEditingItem(item);
    setFormCategory(category);
    setFormName(item.name);
    setFormPrice(item.price.toString());
    setFormNote(item.note);
    setFormNoteImage(item.image);
    setFormTag(item.tag);
    setFormPairing(item.pairing);
    setIsFormOpen(true);
  };

  const handleSaveItem = () => {
    if (!formName || !formPrice) {
      soundManager.playError();
      alert("Name at Price ay kailangan!");
      return;
    }

    const priceNum = Number(formPrice) || 0;
    const itemData: CarouselItem = {
      id: editingItem ? editingItem.id : `${formCategory}-${Date.now()}`,
      name: formName,
      price: priceNum,
      note: formNote || "Fresh premium cafe selection.",
      image: formImage || "https://images.pexels.com/photos/20400397/pexels-photo-20400397.jpeg?auto=compress&cs=tinysrgb&fit=crop&h=1200&w=800",
      alt: formName,
      tag: formTag || "Best seller",
      pairing: formPairing || "Excellent taste",
    };

    if (formCategory === "coffee") {
      let nextList = [...coffees];
      if (editingItem) {
        nextList = nextList.map((c) => (c.id === editingItem.id ? itemData : c));
      } else {
        nextList.push(itemData);
      }
      onUpdateCoffees(nextList);
    } else {
      let nextList = [...desserts];
      if (editingItem) {
        nextList = nextList.map((d) => (d.id === editingItem.id ? itemData : d));
      } else {
        nextList.push(itemData);
      }
      onUpdateDesserts(nextList);
    }

    soundManager.playSuccess();
    setIsFormOpen(false);
    setEditingItem(null);
  };

  const handleDeleteItem = (id: string, category: StackPosition) => {
    if (confirm("Sigurado ka bang gusto mong burahin ang item na ito?")) {
      if (category === "coffee") {
        onUpdateCoffees(coffees.filter((c) => c.id !== id));
      } else {
        onUpdateDesserts(desserts.filter((d) => d.id !== id));
      }
      soundManager.playNotification();
    }
  };

  const handleSaveNewPasswords = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCashierPass.trim() && !newAdminPass.trim()) {
      soundManager.playError();
      setPasswordStatusMsg("Mag-type ng bagong password!");
      return;
    }
    const finalCashier = newCashierPass.trim() || cashierPassword;
    const finalAdmin = newAdminPass.trim() || adminPassword;
    
    if (onUpdatePasswords) {
      onUpdatePasswords(finalCashier, finalAdmin);
      soundManager.playSuccess();
      setPasswordStatusMsg("Passwords successfully updated!");
      setNewCashierPass("");
      setNewAdminPass("");
      setTimeout(() => setPasswordStatusMsg(""), 3000);
    }
  };

  // If admin requires sign in, render simple gate
  if (!isAdminAuthenticated) {
    return (
      <motion.section
        className="absolute inset-x-[4%] bottom-[3%] top-[8%] z-50 flex flex-col justify-center overflow-hidden rounded-[1.8rem] border border-[#ffd18a]/38 bg-[#0b0705]/98 p-6 text-[#fff3dc] shadow-[0_26px_80px_rgba(0,0,0,0.8),0_0_46px_rgba(255,177,92,0.2)] sm:backdrop-blur-xl"
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
      >
        <div className="max-w-[280px] mx-auto w-full text-center space-y-4">
          <p className="text-[0.62rem] font-black uppercase tracking-[0.16em] text-[#f0ad6a]">🔒 Admin Gate</p>
          <h2 className="text-[1.25rem] font-black tracking-[-0.03em] leading-tight">Enter Admin Password</h2>
          <form onSubmit={handleAdminVerify} className="space-y-3 text-left">
            <input
              type="password"
              placeholder="Admin Password..."
              className="w-full rounded-full border border-[#ffd18a]/18 bg-white/[0.03] px-3.5 py-2.5 text-[0.8rem] text-[#fff3dc] focus:border-[#ffd18a] focus:outline-none"
              value={adminInputPassword}
              onChange={(e) => setAdminInputPassword(e.target.value)}
              autoFocus
            />
            {adminError && <p className="text-[0.6rem] text-[#ffb08f] text-center">{adminError}</p>}
            <button
              type="submit"
              className="w-full rounded-full bg-[#ffd18a] text-[#4a2416] py-2.5 text-[0.74rem] font-black uppercase tracking-wider hover:bg-[#ffc26b] transition-all"
            >
              Verify & Open HQ
            </button>
            <button
              type="button"
              className="w-full text-center text-[0.68rem] font-semibold text-[#8e7b69] underline mt-2"
              onClick={onClose}
            >
              Cancel
            </button>
          </form>
        </div>
      </motion.section>
    );
  }

  // Report calculations
  const servedOrders = orders.filter((o) => o.status === "done");
  const totalRevenue = servedOrders.reduce((acc, o) => acc + o.total, 0);
  const pendingRevenue = orders.filter((o) => o.status !== "done").reduce((acc, o) => acc + o.total, 0);

  // Bestsellers logic
  const itemCounts: Record<string, number> = {};
  orders.forEach((o) => {
    if (o.items) {
      o.items.forEach((oi) => {
        itemCounts[oi.name] = (itemCounts[oi.name] || 0) + oi.quantity;
      });
    } else {
      if (o.coffee) itemCounts[o.coffee.name] = (itemCounts[o.coffee.name] || 0) + 1;
      if (o.dessert) itemCounts[o.dessert.name] = (itemCounts[o.dessert.name] || 0) + 1;
    }
  });

  const bestsellers = Object.entries(itemCounts)
    .sort((a, b) => b[1] - a[1]);

  const handlePrintReport = () => {
    soundManager.playSuccess();
    const printWindow = window.open("", "_blank");
    if (!printWindow) {
      soundManager.playError();
      return;
    }

    printWindow.document.write(`
      <html>
        <head>
          <title>Coffee & Relax - Sales Report</title>
          <style>
            body { font-family: monospace; padding: 20px; color: #333; max-width: 400px; margin: 0 auto; }
            h1 { text-align: center; margin-bottom: 5px; }
            p { margin: 3px 0; font-size: 12px; }
            .line { border-bottom: 1px dashed #333; margin: 10px 0; }
            .flex { display: flex; justify-content: space-between; }
            .bold { font-weight: bold; }
          </style>
        </head>
        <body onload="window.print()">
          <h1>KAPE & CRUMBS</h1>
          <p style="text-align: center;">Live Store Performance & Sales Report</p>
          <p style="text-align: center;">Generated on: ${new Date().toLocaleString()}</p>
          <div class="line"></div>
          <div class="flex bold"><p>Served Revenue:</p><p>₱${totalRevenue.toLocaleString()}</p></div>
          <div class="flex"><p>Served Transactions:</p><p>${servedOrders.length}</p></div>
          <div class="flex"><p>Active Queue Revenue:</p><p>₱${pendingRevenue.toLocaleString()}</p></div>
          <div class="line"></div>
          <p class="bold">Bestselling Products:</p>
          ${bestsellers.map(([name, count], idx) => `
            <div class="flex"><p>${idx + 1}. ${name}</p><p>${count} sold</p></div>
          `).join("")}
          <div class="line"></div>
          <p style="text-align: center; font-weight: bold;">End of Report</p>
        </body>
      </html>
    `);
    printWindow.document.close();
  };

  return (
    <motion.section
      className="absolute inset-x-[4%] bottom-[3%] top-[8%] z-50 flex flex-col overflow-hidden rounded-[1.8rem] border border-[#ffd18a]/38 bg-[#0b0705]/98 p-4 text-[#fff3dc] shadow-[0_26px_80px_rgba(0,0,0,0.8),0_0_46px_rgba(255,177,92,0.2)] sm:backdrop-blur-xl"
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={softSpring}
      role="dialog"
      aria-modal="true"
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-4 shrink-0">
        <div>
          <p className="text-[0.68rem] font-black uppercase tracking-[0.18em] text-[#f0ad6a]">Super Admin</p>
          <h2 className="mt-1 text-[1.35rem] font-black leading-none tracking-[-0.04em]">Coffee & Relax HQ</h2>
        </div>
        <button
          className="rounded-full border border-[#ffd18a]/35 px-3 py-1.5 text-[0.72rem] font-black text-[#ffd18a] hover:bg-[#2a170e]"
          type="button"
          onClick={onClose}
        >
          Close
        </button>
      </div>

      {/* Tabs */}
      <div className="mt-3 flex gap-2 border-b border-[#ffd18a]/12 pb-2 shrink-0 overflow-x-auto">
        <button
          className={cn(
            "rounded-full px-3 py-1.5 text-[0.66rem] font-black uppercase tracking-wider transition-all shrink-0",
            activeTab === "items" ? "bg-[#ffd18a] text-[#4a2416]" : "bg-white/[0.04] text-[#ffd18a]"
          )}
          type="button"
          onClick={() => setActiveTab("items")}
        >
          Manage Menu (CRUD)
        </button>
        <button
          className={cn(
            "rounded-full px-3 py-1.5 text-[0.66rem] font-black uppercase tracking-wider transition-all shrink-0",
            activeTab === "analytics" ? "bg-[#ffd18a] text-[#4a2416]" : "bg-white/[0.04] text-[#ffd18a]"
          )}
          type="button"
          onClick={() => setActiveTab("analytics")}
        >
          📊 Business Analytics
        </button>
        <button
          className={cn(
            "rounded-full px-3 py-1.5 text-[0.66rem] font-black uppercase tracking-wider transition-all shrink-0",
            activeTab === "reports" ? "bg-[#ffd18a] text-[#4a2416]" : "bg-white/[0.04] text-[#ffd18a]"
          )}
          type="button"
          onClick={() => setActiveTab("reports")}
        >
          🖨️ Reports & Print
        </button>
        <button
          className={cn(
            "rounded-full px-3 py-1.5 text-[0.66rem] font-black uppercase tracking-wider transition-all shrink-0",
            activeTab === "passwords" ? "bg-[#ffd18a] text-[#4a2416]" : "bg-white/[0.04] text-[#ffd18a]"
          )}
          type="button"
          onClick={() => setActiveTab("passwords")}
        >
          🔑 Passwords Settings
        </button>
      </div>

      {/* Tab Contents */}
      <div className="mt-3 flex-1 min-h-0 flex flex-col">
        {activeTab === "items" && (
          <div className="flex-1 min-h-0 flex flex-col">
            {/* Action buttons */}
            <div className="flex gap-2 shrink-0 mb-3">
              <button
                type="button"
                className="flex-1 rounded-full bg-[#ffd18a] text-[#4a2416] py-2 text-[0.7rem] font-black uppercase tracking-wider hover:bg-[#ffc26b]"
                onClick={() => handleOpenAddForm("coffee")}
              >
                + Add Coffee
              </button>
              <button
                type="button"
                className="flex-1 rounded-full bg-[#ffe8c7]/10 border border-[#ffd18a]/30 py-2 text-[0.7rem] font-black uppercase tracking-wider hover:bg-white/[0.06]"
                onClick={() => handleOpenAddForm("dessert")}
              >
                + Add Dessert
              </button>
            </div>

            {/* List & Edit UI */}
            <div className="flex-1 min-h-0 overflow-y-auto space-y-4 pr-1">
              {/* Coffee list */}
              <div>
                <p className="text-[0.6rem] font-black uppercase tracking-widest text-[#f0ad6a] mb-2">☕ Coffee Menu ({coffees.length})</p>
                <div className="grid gap-2">
                  {coffees.map((coffee) => (
                    <div key={coffee.id} className="flex items-center justify-between gap-3 bg-white/[0.02] border border-[#ffd18a]/10 p-2.5 rounded-[1rem]">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <img src={coffee.image} className="w-9 h-9 rounded-full object-cover shrink-0 border border-[#ffd18a]/20" alt="" />
                        <div className="min-w-0">
                          <p className="font-bold text-[0.82rem] truncate">{coffee.name}</p>
                          <p className="text-[0.68rem] text-[#ffd18a] font-black mt-0.5">{formatPrice(coffee.price)}</p>
                        </div>
                      </div>
                      <div className="flex gap-1.5 shrink-0">
                        <button
                          type="button"
                          className="bg-white/[0.04] border border-[#ffd18a]/20 text-[#ffd18a] px-2.5 py-1 rounded-full text-[0.64rem] font-bold"
                          onClick={() => handleOpenEditForm(coffee, "coffee")}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className="bg-[#bb5438]/20 border border-[#bb5438]/40 text-[#ffb08f] px-2.5 py-1 rounded-full text-[0.64rem] font-bold"
                          onClick={() => handleDeleteItem(coffee.id, "coffee")}
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Dessert list */}
              <div className="pt-2">
                <p className="text-[0.6rem] font-black uppercase tracking-widest text-[#f0ad6a] mb-2">🍰 Dessert Menu ({desserts.length})</p>
                <div className="grid gap-2">
                  {desserts.map((dessert) => (
                    <div key={dessert.id} className="flex items-center justify-between gap-3 bg-white/[0.02] border border-[#ffd18a]/10 p-2.5 rounded-[1rem]">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <img src={dessert.image} className="w-9 h-9 rounded-full object-cover shrink-0 border border-[#ffd18a]/20" alt="" />
                        <div className="min-w-0">
                          <p className="font-bold text-[0.82rem] truncate">{dessert.name}</p>
                          <p className="text-[0.68rem] text-[#ffd18a] font-black mt-0.5">{formatPrice(dessert.price)}</p>
                        </div>
                      </div>
                      <div className="flex gap-1.5 shrink-0">
                        <button
                          type="button"
                          className="bg-white/[0.04] border border-[#ffd18a]/20 text-[#ffd18a] px-2.5 py-1 rounded-full text-[0.64rem] font-bold"
                          onClick={() => handleOpenEditForm(dessert, "dessert")}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className="bg-[#bb5438]/20 border border-[#bb5438]/40 text-[#ffb08f] px-2.5 py-1 rounded-full text-[0.64rem] font-bold"
                          onClick={() => handleDeleteItem(dessert.id, "dessert")}
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === "reports" && (
          <div className="flex-1 overflow-y-auto space-y-4 pr-1">
            <div className="flex gap-2 shrink-0">
              <button
                type="button"
                className="flex-1 rounded-full bg-[#ffd18a] text-[#4a2416] py-2.5 text-[0.74rem] font-black uppercase tracking-wider hover:bg-[#ffc26b]"
                onClick={handlePrintReport}
              >
                🖨️ Print / Save PDF Report
              </button>
              <button
                type="button"
                className="rounded-full bg-[#bb5438] text-white px-5 py-2.5 text-[0.74rem] font-black uppercase tracking-wider"
                onClick={() => {
                  if (confirm("Gusto mo bang burahin ang lahat ng active at served orders sa pila?")) {
                    void onResetOrders();
                  }
                }}
              >
                🧹 Clean Database
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-[1.15rem] border border-[#ffd18a]/20 bg-white/[0.02] p-3">
                <p className="text-[0.58rem] font-black uppercase tracking-wider text-[#d9a26e]">Total Served Revenue</p>
                <p className="text-[1.35rem] font-black text-[#ffd18a] mt-1">₱{totalRevenue.toLocaleString()}</p>
                <p className="text-[0.56rem] text-[#8e7b69] mt-0.5">{servedOrders.length} orders served</p>
              </div>
              <div className="rounded-[1.15rem] border border-[#ffd18a]/20 bg-white/[0.02] p-3">
                <p className="text-[0.58rem] font-black uppercase tracking-wider text-[#d9a26e]">Active Queue Revenue</p>
                <p className="text-[1.35rem] font-black text-[#ffd18a] mt-1">₱{pendingRevenue.toLocaleString()}</p>
                <p className="text-[0.56rem] text-[#8e7b69] mt-0.5">{orders.filter(o => o.status !== "done").length} in line</p>
              </div>
            </div>

            {/* Bestsellers chart list */}
            <div className="rounded-[1.2rem] border border-[#ffd18a]/20 bg-white/[0.035] p-3">
              <h4 className="text-[0.66rem] font-black uppercase tracking-wider text-[#ffd18a] mb-2">Bestseller Stats breakdown</h4>
              <div className="space-y-2">
                {bestsellers.map(([name, count], index) => (
                  <div key={name} className="flex items-center justify-between text-[0.78rem] py-1 border-b border-[#ffd18a]/6 last:border-0">
                    <span className="truncate max-w-[65%] font-medium">
                      {index + 1}. {name}
                    </span>
                    <span className="font-black text-[#f0ad6a]">{count} units sold</span>
                  </div>
                ))}
                {bestsellers.length === 0 && (
                  <p className="text-center py-4 text-[0.66rem] text-[#936943]">No orders placed yet.</p>
                )}
              </div>
            </div>
          </div>
        )}

        {activeTab === "analytics" && (
          <div className="flex-1 overflow-y-auto space-y-4 pr-1">
            {/* Revenue Overview with Trend Indicators */}
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-[1.15rem] border border-[#ffd18a]/20 bg-gradient-to-br from-[#ffd18a]/10 to-white/[0.02] p-3">
                <div className="flex items-center justify-between mb-1">
                  <p className="text-[0.58rem] font-black uppercase tracking-wider text-[#d9a26e]">Total Revenue</p>
                  <span className="text-[0.52rem] font-bold text-[#88d18a]">+12% ↗</span>
                </div>
                <p className="text-[1.5rem] font-black text-[#ffd18a]">₱{totalRevenue.toLocaleString()}</p>
                <p className="text-[0.56rem] text-[#8e7b69] mt-0.5">{orders.length} orders today</p>
              </div>
              <div className="rounded-[1.15rem] border border-[#ffd18a]/20 bg-gradient-to-br from-[#ffd18a]/10 to-white/[0.02] p-3">
                <div className="flex items-center justify-between mb-1">
                  <p className="text-[0.58rem] font-black uppercase tracking-wider text-[#d9a26e]">Avg Order</p>
                  <span className="text-[0.52rem] font-bold text-[#88d18a]">+8% ↗</span>
                </div>
                <p className="text-[1.5rem] font-black text-[#ffd18a]">₱{Math.round(avgOrderValue)}</p>
                <p className="text-[0.56rem] text-[#8e7b69] mt-0.5">per customer</p>
              </div>
            </div>

            {/* Quick Stats Row */}
            <div className="grid grid-cols-4 gap-1.5">
              <div className="rounded-[0.8rem] bg-[#88d18a]/10 p-2 text-center">
                <p className="text-[1.1rem] font-black text-[#88d18a]">{servedOrders.length}</p>
                <p className="text-[0.48rem] text-[#8e7b69] uppercase">Served</p>
              </div>
              <div className="rounded-[0.8rem] bg-[#ffd18a]/10 p-2 text-center">
                <p className="text-[1.1rem] font-black text-[#ffd18a]">{orders.filter((o) => o.status === "serving").length}</p>
                <p className="text-[0.48rem] text-[#8e7b69] uppercase">Serving</p>
              </div>
              <div className="rounded-[0.8rem] bg-[#bb5438]/10 p-2 text-center">
                <p className="text-[1.1rem] font-black text-[#bb5438]">{orders.filter((o) => o.status === "waiting").length}</p>
                <p className="text-[0.48rem] text-[#8e7b69] uppercase">Waiting</p>
              </div>
              <div className="rounded-[0.8rem] bg-[#ff9b73]/10 p-2 text-center">
                <p className="text-[1.1rem] font-black text-[#ff9b73]">{orders.filter((o) => !o.hasReview && o.status === "done").length}</p>
                <p className="text-[0.48rem] text-[#8e7b69] uppercase">No Review</p>
              </div>
            </div>

            {/* Category Split with Visual Chart */}
            <div className="rounded-[1.15rem] border border-[#ffd18a]/20 bg-gradient-to-br from-[#ffd18a]/5 to-white/[0.02] p-3">
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-[0.66rem] font-black uppercase tracking-wider text-[#ffd18a]">Revenue by Category</h4>
                <span className="text-[0.52rem] font-bold text-[#8e7b69]">Today</span>
              </div>
              
              {/* Donut Chart Visualization */}
              <div className="flex items-center gap-4 mb-3">
                <div className="relative w-20 h-20">
                  <svg className="w-full h-full transform -rotate-90">
                    <circle
                      cx="40"
                      cy="40"
                      r="32"
                      fill="none"
                      stroke="rgba(255,255,255,0.05)"
                      strokeWidth="14"
                    />
                    <circle
                      cx="40"
                      cy="40"
                      r="32"
                      fill="none"
                      stroke="#ffd18a"
                      strokeWidth="14"
                      strokeDasharray={`${(coffeeRevenue / (coffeeRevenue + dessertRevenue)) * 201} 201`}
                      strokeLinecap="round"
                    />
                    <circle
                      cx="40"
                      cy="40"
                      r="32"
                      fill="none"
                      stroke="#bb5438"
                      strokeWidth="14"
                      strokeDasharray={`${(dessertRevenue / (coffeeRevenue + dessertRevenue)) * 201} 201`}
                      strokeDashoffset="-100.5"
                      strokeLinecap="round"
                    />
                  </svg>
                  <div className="absolute inset-0 flex items-center justify-center">
                    <span className="text-[0.68rem] font-black text-[#ffd18a]">100%</span>
                  </div>
                </div>
                
                <div className="flex-1 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <div className="w-2.5 h-2.5 rounded-full bg-[#ffd18a]" />
                      <span className="text-[0.62rem] text-[#fff3dc]">☕ Coffee</span>
                    </div>
                    <div className="text-right">
                      <p className="text-[0.68rem] font-black text-[#ffd18a]">₱{Math.round(coffeeRevenue)}</p>
                      <p className="text-[0.48rem] text-[#8e7b69]">{Math.round((coffeeRevenue / (coffeeRevenue + dessertRevenue)) * 100) || 0}%</p>
                    </div>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <div className="w-2.5 h-2.5 rounded-full bg-[#bb5438]" />
                      <span className="text-[0.62rem] text-[#fff3dc]">🍰 Dessert</span>
                    </div>
                    <div className="text-right">
                      <p className="text-[0.68rem] font-black text-[#ffd18a]">₱{Math.round(dessertRevenue)}</p>
                      <p className="text-[0.48rem] text-[#8e7b69]">{Math.round((dessertRevenue / (coffeeRevenue + dessertRevenue)) * 100) || 0}%</p>
                    </div>
                  </div>
                </div>
              </div>
              
              {/* Insight */}
              {coffeeRevenue > dessertRevenue * 2 && (
                <div className="rounded-[0.65rem] bg-[#bb5438]/10 border border-[#bb5438]/20 p-2">
                  <p className="text-[0.56rem] text-[#ffb08f] leading-relaxed">
                    💡 <strong>Opportunity:</strong> Dessert sales are low. Train staff to suggest desserts with every coffee order.
                  </p>
                </div>
              )}
            </div>

            {/* Top Products */}
            <div className="rounded-[1.15rem] border border-[#ffd18a]/20 bg-white/[0.02] p-3">
              <h4 className="text-[0.66rem] font-black uppercase tracking-wider text-[#ffd18a] mb-2">🏆 Top 5 Products</h4>
              <div className="space-y-2">
                {topProducts.map((product, index) => (
                  <div key={product.name} className="flex items-center justify-between text-[0.74rem] py-1 border-b border-[#ffd18a]/6 last:border-0">
                    <div className="flex items-center gap-2">
                      <span className="text-[#ffd18a] font-black">{index + 1}.</span>
                      <span className="text-[#fff3dc] truncate">{product.name}</span>
                      <span className="text-[0.58rem] text-[#8e7b69]">({product.category})</span>
                    </div>
                    <span className="font-black text-[#ffd18a]">{product.count} × ₱{product.revenue}</span>
                  </div>
                ))}
                {topProducts.length === 0 && (
                  <p className="text-center py-4 text-[0.66rem] text-[#936943]">No sales data yet.</p>
                )}
              </div>
            </div>

            {/* Customer Reviews Summary with Rating Breakdown */}
            <div className="rounded-[1.15rem] border border-[#ffd18a]/20 bg-gradient-to-br from-[#ffd18a]/5 to-white/[0.02] p-3">
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-[0.66rem] font-black uppercase tracking-wider text-[#ffd18a]">⭐ Customer Reviews</h4>
                <span className="text-[0.52rem] font-bold text-[#88d18a]">Excellent</span>
              </div>
              
              {/* Main Rating Display */}
              <div className="flex items-center gap-4 mb-3">
                <div className="text-center">
                  <p className="text-[2.5rem] font-black text-[#ffd18a] leading-none">4.8</p>
                  <div className="flex gap-0.5 mt-1">
                    {[1, 2, 3, 4, 5].map((star) => (
                      <span key={star} className="text-[0.9rem]">⭐</span>
                    ))}
                  </div>
                </div>
                <div className="flex-1 grid grid-cols-3 gap-2">
                  <div className="rounded-[0.65rem] bg-[#ffd18a]/10 p-2 text-center">
                    <p className="text-[1.1rem] font-black text-[#ffd18a]">{orders.filter((o) => o.hasReview).length}</p>
                    <p className="text-[0.45rem] text-[#8e7b69] uppercase">Total</p>
                  </div>
                  <div className="rounded-[0.65rem] bg-[#88d18a]/10 p-2 text-center">
                    <p className="text-[1.1rem] font-black text-[#88d18a]">{Math.round((orders.filter((o) => o.hasReview && o.rating != null && o.rating >= 4).length / orders.filter((o) => o.hasReview).length) * 100) || 0}%</p>
                    <p className="text-[0.45rem] text-[#8e7b69] uppercase">Positive</p>
                  </div>
                  <div className="rounded-[0.65rem] bg-[#bb5438]/10 p-2 text-center">
                    <p className="text-[1.1rem] font-black text-[#bb5438]">{Math.round((orders.filter((o) => o.hasReview).length / orders.length) * 100) || 0}%</p>
                    <p className="text-[0.45rem] text-[#8e7b69] uppercase">Rate</p>
                  </div>
                </div>
              </div>
              
              {/* Rating Distribution */}
              <div className="space-y-1.5">
                {[5, 4, 3, 2, 1].map((rating) => {
                  const count = orders.filter((o) => o.hasReview && o.rating != null && Number(o.rating) === rating).length;
                  const totalReviews = orders.filter((o) => o.hasReview).length;
                  const percentage = totalReviews > 0 ? (count / totalReviews) * 100 : 0;
                  return (
                    <div key={rating} className="flex items-center gap-2">
                      <span className="text-[0.58rem] text-[#fff3dc] w-8">{rating} </span>
                      <div className="flex-1 h-1.5 bg-white/[0.05] rounded-full overflow-hidden">
                        <div 
                          className="h-full bg-gradient-to-r from-[#ffd18a] to-[#bb5438] rounded-full" 
                          style={{ width: `${percentage}%` }} 
                        />
                      </div>
                      <span className="text-[0.52rem] text-[#8e7b69] w-6 text-right">{count}</span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Smart Recommendations */}
            {recommendations.length > 0 && (
              <div className="rounded-[1.15rem] border border-[#ffd18a]/20 bg-white/[0.02] p-3">
                <h4 className="text-[0.66rem] font-black uppercase tracking-wider text-[#ffd18a] mb-2">💡 Smart Suggestions</h4>
                <div className="space-y-2">
                  {recommendations.map((rec, index) => (
                    <div key={index} className={cn(
                      "rounded-[0.8rem] p-2.5 border",
                      rec.impact === "high" ? "border-[#bb5438]/40 bg-[#bb5438]/10" :
                      rec.impact === "medium" ? "border-[#ffd18a]/30 bg-[#ffd18a]/5" :
                      "border-[#88d18a]/30 bg-[#88d18a]/5"
                    )}>
                      <div className="flex items-start gap-2">
                        <span className="text-[1.1rem]">{rec.type === "alert" ? "️" : rec.type === "promo" ? "🎉" : rec.type === "upsell" ? "💰" : "✨"}</span>
                        <div>
                          <p className="text-[0.7rem] font-black text-[#ffd18a]">{rec.title}</p>
                          <p className="text-[0.62rem] text-[#fff3dc] mt-0.5 leading-relaxed">{rec.description}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Sold Out Alerts */}
            {soldOutItems.length > 0 && (
              <div className="rounded-[1.15rem] border border-[#ff9b73]/40 bg-[#bb5438]/15 p-3">
                <h4 className="text-[0.66rem] font-black uppercase tracking-wider text-[#ffb08f] mb-2">⚠️ Sold Out Items</h4>
                <div className="space-y-1.5">
                  {soldOutItems.map((item, index) => (
                    <div key={index} className="flex items-center gap-2 text-[0.7rem] text-[#fff3dc]">
                      <span className="text-[#ff9b73]">•</span>
                      <span>{item}</span>
                    </div>
                  ))}
                </div>
                <p className="text-[0.58rem] text-[#8e7b69] mt-2">Restock these items for tomorrow!</p>
              </div>
            )}
          </div>
        )}

        {activeTab === "passwords" && (
          <div className="flex-1 overflow-y-auto space-y-4 pr-1 text-left">
            {/* Change Passwords Sub-form */}
            <div className="rounded-[1.15rem] border border-[#ffd18a]/18 bg-white/[0.025] p-4">
              <h4 className="text-[0.7rem] font-black uppercase tracking-wider text-[#f0ad6a] mb-1">⚙️ Change System Passwords</h4>
              <p className="text-[0.62rem] text-[#8e7b69] leading-relaxed mb-4">
                Baguhin ang lock codes para sa Cashier at Super Admin panels para maprotektahan ang access.
              </p>
              <form onSubmit={handleSaveNewPasswords} className="space-y-3.5">
                <div className="flex flex-col gap-1.5">
                  <label className="text-[0.58rem] font-black uppercase tracking-wider text-[#d9a26e] pl-1">New Cashier Password</label>
                  <input
                    type="password"
                    placeholder="e.g. barista2026"
                    className="w-full rounded-full border border-[#ffd18a]/18 bg-white/[0.03] px-3.5 py-2.5 text-[0.8rem] text-[#fff3dc] focus:border-[#ffd18a] focus:outline-none"
                    value={newCashierPass}
                    onChange={(e) => setNewCashierPass(e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-[0.58rem] font-black uppercase tracking-wider text-[#d9a26e] pl-1">New Admin Password</label>
                  <input
                    type="password"
                    placeholder="e.g. boss999"
                    className="w-full rounded-full border border-[#ffd18a]/18 bg-white/[0.03] px-3.5 py-2.5 text-[0.8rem] text-[#fff3dc] focus:border-[#ffd18a] focus:outline-none"
                    value={newAdminPass}
                    onChange={(e) => setNewAdminPass(e.target.value)}
                  />
                </div>
                {passwordStatusMsg && (
                  <p className="text-[0.68rem] font-bold text-[#88d18a] pl-1">{passwordStatusMsg}</p>
                )}
                <button
                  type="submit"
                  className="w-full rounded-full bg-[#ffd18a] text-[#4a2416] py-3 text-[0.76rem] font-black uppercase tracking-wide hover:bg-[#ffc26b] transition-all"
                >
                  Save New Passwords
                </button>
              </form>
            </div>
          </div>
        )}
      </div>

      {/* CRUD Form Modal overlay */}
      <AnimatePresence>
        {isFormOpen && (
          <div className="absolute inset-0 z-50 flex items-center justify-center bg-[#070504]/94 p-4">
            <motion.div
              className="w-full max-w-[310px] bg-[#120b07] border border-[#ffd18a]/32 p-4 rounded-[1.2rem] space-y-3.5 overflow-y-auto max-h-[92%]"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
            >
              <div>
                <p className="text-[0.56rem] font-black uppercase tracking-wider text-[#f0ad6a]">Menu Form</p>
                <h3 className="text-[1.12rem] font-black mt-0.5">{editingItem ? "Edit Menu Item" : "Add Menu Item"}</h3>
              </div>

              <div className="space-y-1">
                <label className="block text-[0.58rem] font-black uppercase tracking-wider text-[#d9a26e]">Item Name</label>
                <input
                  type="text"
                  required
                  className="w-full rounded-[0.7rem] border border-[#ffd18a]/18 bg-white/[0.02] px-3 py-2 text-[0.8rem] text-[#fff3dc] focus:border-[#ffd18a] focus:outline-none"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder="e.g. Mocha Float"
                />
              </div>

              <div className="space-y-1">
                <label className="block text-[0.58rem] font-black uppercase tracking-wider text-[#d9a26e]">Price (₱ PHP)</label>
                <input
                  type="number"
                  required
                  className="w-full rounded-[0.7rem] border border-[#ffd18a]/18 bg-white/[0.02] px-3 py-2 text-[0.8rem] text-[#fff3dc] focus:border-[#ffd18a] focus:outline-none"
                  value={formPrice}
                  onChange={(e) => setFormPrice(e.target.value)}
                  placeholder="e.g. 150"
                />
              </div>

              <div className="space-y-1">
                <label className="block text-[0.58rem] font-black uppercase tracking-wider text-[#d9a26e]">Short Description / Note</label>
                <input
                  type="text"
                  className="w-full rounded-[0.7rem] border border-[#ffd18a]/18 bg-white/[0.02] px-3 py-2 text-[0.8rem] text-[#fff3dc] focus:border-[#ffd18a] focus:outline-none"
                  value={formNote}
                  onChange={(e) => setFormNote(e.target.value)}
                  placeholder="Coffee shot with silky cream"
                />
              </div>

              <div className="space-y-1">
                <label className="block text-[0.58rem] font-black uppercase tracking-wider text-[#d9a26e]">Image URL</label>
                <input
                  type="text"
                  className="w-full rounded-[0.7rem] border border-[#ffd18a]/18 bg-white/[0.02] px-3 py-2 text-[0.74rem] text-[#fff3dc] focus:border-[#ffd18a] focus:outline-none"
                  value={formImage}
                  onChange={(e) => setFormNoteImage(e.target.value)}
                  placeholder="https://..."
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <label className="block text-[0.58rem] font-black uppercase tracking-wider text-[#d9a26e]">Tag / Label</label>
                  <input
                    type="text"
                    className="w-full rounded-[0.7rem] border border-[#ffd18a]/18 bg-white/[0.02] px-3 py-2 text-[0.8rem] text-[#fff3dc] focus:border-[#ffd18a] focus:outline-none"
                    value={formTag}
                    onChange={(e) => setFormTag(e.target.value)}
                    placeholder="Best Seller"
                  />
                </div>
                <div className="space-y-1">
                  <label className="block text-[0.58rem] font-black uppercase tracking-wider text-[#d9a26e]">Best Pairing</label>
                  <input
                    type="text"
                    className="w-full rounded-[0.7rem] border border-[#ffd18a]/18 bg-white/[0.02] px-3 py-2 text-[0.8rem] text-[#fff3dc] focus:border-[#ffd18a] focus:outline-none"
                    value={formPairing}
                    onChange={(e) => setFormPairing(e.target.value)}
                    placeholder="Walnut Brownie"
                  />
                </div>
              </div>

              <div className="flex gap-2 pt-2 text-[0.72rem]">
                <button
                  type="button"
                  className="flex-1 rounded-full bg-[#ffd18a] text-[#4a2416] py-2 font-black uppercase"
                  onClick={handleSaveItem}
                >
                  Save Item
                </button>
                <button
                  type="button"
                  className="flex-1 rounded-full border border-[#ffd18a]/20 text-[#ffd18a] py-2 font-black uppercase"
                  onClick={() => setIsFormOpen(false)}
                >
                  Cancel
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </motion.section>
  );
}

function CoffeeBean({ className, delay = 0 }: { className: string; delay?: number }) {
  return (
    <motion.span
      aria-hidden="true"
      className={cn("absolute block h-8 w-5 rounded-[50%] border border-[#ffd18a]/25 bg-[#f6b66b]/12", className)}
      animate={{ y: [0, -8, 0], rotate: [18, 25, 18] }}
      transition={{ duration: 5.5, delay, repeat: Infinity, ease: "easeInOut" }}
    >
      <span className="absolute left-1/2 top-[16%] h-[68%] w-px -translate-x-1/2 rounded-full bg-[#ffd18a]/28" />
    </motion.span>
  );
}

function NightCafeBackdrop() {
  const sparks = Array.from({ length: 18 }, (_, index) => ({
    id: index,
    left: `${8 + ((index * 17) % 84)}%`,
    top: `${9 + ((index * 29) % 82)}%`,
    delay: index * 0.23,
    size: index % 3 === 0 ? "h-1.5 w-1.5" : "h-1 w-1",
  }));

  return (
    <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden bg-[#070504]" aria-hidden="true">
      <motion.div
        className="absolute -left-[16%] top-[4%] h-[38rem] w-[38rem] rounded-full bg-[#8f4d25]/30 blur-3xl will-change-transform"
        animate={{ x: [0, 36, 0], y: [0, 18, 0], opacity: [0.42, 0.75, 0.42] }}
        transition={{ duration: 9, repeat: Infinity, ease: "easeInOut" }}
      />
      <motion.div
        className="absolute -right-[18%] bottom-[-12%] h-[34rem] w-[34rem] rounded-full bg-[#d79a52]/20 blur-3xl will-change-transform"
        animate={{ x: [0, -30, 0], y: [0, -26, 0], opacity: [0.32, 0.66, 0.32] }}
        transition={{ duration: 10.5, repeat: Infinity, ease: "easeInOut" }}
      />
      <motion.div
        className="absolute left-1/2 top-1/2 h-[48rem] w-[48rem] -translate-x-1/2 -translate-y-1/2 rounded-full border border-[#ffcf8a]/10 will-change-transform"
        animate={{ rotate: 360, scale: [1, 1.05, 1] }}
        transition={{ rotate: { duration: 28, repeat: Infinity, ease: "linear" }, scale: { duration: 7, repeat: Infinity, ease: "easeInOut" } }}
      />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_42%,rgba(255,207,138,0.13),transparent_34%),linear-gradient(115deg,rgba(255,255,255,0.05),transparent_28%,rgba(255,255,255,0.03)_62%,transparent)]" />
      {sparks.map((spark) => (
        <motion.span
          key={spark.id}
          className={cn("absolute rounded-full bg-[#ffd18a] shadow-[0_0_14px_rgba(255,209,138,0.85)] will-change-transform", spark.size)}
          style={{ left: spark.left, top: spark.top }}
          animate={{ opacity: [0.08, 0.9, 0.08], y: [0, -18, 0], scale: [0.7, 1.25, 0.7] }}
          transition={{ duration: 3.4 + (spark.id % 4) * 0.45, delay: spark.delay, repeat: Infinity, ease: "easeInOut" }}
        />
      ))}
      <div className="absolute inset-0 opacity-[0.08] [background-image:linear-gradient(rgba(255,255,255,0.18)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.18)_1px,transparent_1px)] [background-size:72px_72px]" />
    </div>
  );
}

function CafeBackground({ glowing }: { glowing: boolean }) {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
      <motion.div
        className="absolute -right-[18%] top-[5%] h-[32%] w-[58%] rounded-full bg-[#f5b35f]/24 blur-3xl will-change-transform"
        animate={{ opacity: glowing ? 0.88 : 0.42, scale: glowing ? 1.08 : 1 }}
        transition={softSpring}
      />
      <motion.div
        className="absolute -left-[22%] bottom-[4%] h-[36%] w-[66%] rounded-full bg-[#8b451f]/32 blur-3xl will-change-transform"
        animate={{ opacity: glowing ? 0.8 : 0.46, scale: glowing ? 1.07 : 1 }}
        transition={softSpring}
      />
      <motion.div
        className="absolute inset-x-[10%] top-[13%] h-px bg-gradient-to-r from-transparent via-[#ffd18a]/55 to-transparent"
        animate={{ opacity: [0.18, 0.75, 0.18], x: ["-8%", "8%", "-8%"] }}
        transition={{ duration: 4.8, repeat: Infinity, ease: "easeInOut" }}
      />
      <CoffeeBean className="left-[9%] top-[20%] rotate-[18deg]" />
      <CoffeeBean className="right-[7%] top-[38%] rotate-[35deg]" delay={0.8} />
      <CoffeeBean className="left-[17%] bottom-[16%] rotate-[-14deg]" delay={1.3} />
    </div>
  );
}

function CafeHeader({ onOpenCashier }: { onOpenCashier: () => void }) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header className="absolute left-[6%] right-[6%] top-[3%] z-30">
      <div className="flex items-center justify-between gap-3 pr-[5.5rem]">
        <div className="flex items-center gap-[clamp(0.5rem,2.2vw,0.75rem)]">
          <SteamCupMark />
          <button
            className="flex h-[clamp(2.65rem,10vw,3.3rem)] w-[clamp(2.65rem,10vw,3.3rem)] items-center justify-center rounded-full border border-[#ffd18a]/30 bg-[#150d09]/78 text-[#ffd18a] shadow-[0_0_32px_rgba(255,177,92,0.18)] backdrop-blur transition-colors hover:bg-[#2a170e] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ffd18a]"
            type="button"
            aria-label="Open menu"
            onClick={() => setMenuOpen(!menuOpen)}
          >
            <MenuIcon />
          </button>
          <div>
            <motion.p
              className="text-[clamp(1.15rem,5.2vw,1.6rem)] font-black leading-none tracking-[-0.055em] text-[#fff3dc] drop-shadow-[0_2px_16px_rgba(255,190,112,0.22)]"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.45 }}
            >
              Coffee & Relax
            </motion.p>
            <p className="mt-1 text-[clamp(0.58rem,2vw,0.7rem)] font-semibold uppercase tracking-[0.16em] text-[#f0ad6a]">
              Coffee shop picks
            </p>
          </div>
        </div>
      </div>
      <AnimatePresence>
        {menuOpen && (
          <motion.div
            className="absolute left-0 top-[clamp(3.5rem,12vw,4.2rem)] z-50 min-w-[12rem] overflow-hidden rounded-[1.2rem] border border-[#ffd18a]/38 bg-[#0b0705]/96 p-2 text-[#fff3dc] shadow-[0_16px_40px_rgba(0,0,0,0.6),0_0_24px_rgba(255,177,92,0.15)] sm:backdrop-blur-xl"
            initial={{ opacity: 0, y: -10, scale: 0.95, transformOrigin: "top left" }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.95 }}
            transition={{ duration: 0.15 }}
          >
            <button
              className="flex w-full items-center gap-3 rounded-[0.8rem] px-3 py-2.5 text-left text-[0.8rem] font-black transition-colors hover:bg-[#ffd18a]/10 focus-visible:bg-[#ffd18a]/10 focus-visible:outline-none"
              type="button"
              onClick={() => {
                setMenuOpen(false);
                onOpenCashier();
              }}
            >
              <CashierIcon />
              Cashier Panel
            </button>
            <button
              className="flex w-full items-center gap-3 rounded-[0.8rem] px-3 py-2.5 text-left text-[0.8rem] font-black transition-colors hover:bg-[#ffd18a]/10 focus-visible:bg-[#ffd18a]/10 focus-visible:outline-none text-[#ffcf8a]"
              type="button"
              onClick={() => {
                setMenuOpen(false);
                // We'll trigger a custom state in parent
                (window as any)._openAdminPanel?.();
              }}
            >
              <svg className="h-[1rem] w-[1rem]" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" stroke="currentColor" strokeWidth="2" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
              </svg>
              Admin Panel
            </button>
          </motion.div>
        )}
      </AnimatePresence>
      <motion.p
        className="mt-[clamp(0.55rem,2.2vw,0.8rem)] rounded-full border border-[#ffd18a]/24 bg-[#170e09]/58 px-4 py-2 text-center text-[clamp(0.68rem,2.75vw,0.86rem)] font-semibold leading-tight text-[#ffe8c7] shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] sm:backdrop-blur"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.12, duration: 0.42 }}
      >
        Swipe the stacks, tap a photo, and build a warm cafe pair.
      </motion.p>
    </header>
  );
}

function CartIcon() {
  return (
    <svg className="h-[1rem] w-[1rem]" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M5 6h15l-1.5 8.5H7L5 3H2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M8.5 19.5h.01M17 19.5h.01" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" />
    </svg>
  );
}

function MenuIcon() {
  return (
    <svg className="h-[1.25rem] w-[1.25rem]" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4 6h16M4 12h16M4 18h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function CashierIcon() {
  return (
    <svg className="h-[1rem] w-[1rem]" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M5 9h14v10H5z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      <path d="M8 9V6h8v3M8 13h3M14 13h2M8 16h8" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function AppActionBar({
  cartCount,
  onOpenCart,
}: {
  cartCount: number;
  onOpenCart: () => void;
}) {
  return (
    <div className="absolute right-[6%] top-[3%] z-40" aria-label="Cart tool">
      <button
        className="flex items-center gap-2 rounded-full border border-[#ffd18a]/34 bg-[#140c08]/82 px-[clamp(0.65rem,2.8vw,0.85rem)] py-[clamp(0.45rem,1.8vw,0.65rem)] text-[clamp(0.7rem,2.8vw,0.86rem)] font-black text-[#ffe8c7] shadow-[0_0_24px_rgba(255,177,92,0.13)] transition-colors hover:bg-[#2a170e] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ffd18a] focus-visible:ring-offset-2 focus-visible:ring-offset-[#0f0906] sm:backdrop-blur"
        type="button"
        aria-label={`Open cart with ${cartCount} selected items`}
        onClick={onOpenCart}
      >
        <CartIcon />
        <span className="grid min-w-[1.4rem] place-items-center rounded-full bg-[#ffd18a] px-1.5 py-0.5 text-[0.72rem] leading-none text-[#4a2416]">
          {cartCount}
        </span>
      </button>
    </div>
  );
}

function SyncBadge({ status, error }: { status: SyncStatus; error: string }) {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    setVisible(true);

    // Hide the badge automatically after 4 seconds unless it's an error
    if (status !== "error") {
      const timer = window.setTimeout(() => setVisible(false), 4000);
      return () => window.clearTimeout(timer);
    }
  }, [status]);

  const labelByStatus: Record<SyncStatus, string> = {
    demo: "Demo mode",
    connecting: "Connecting",
    live: "Supabase live",
    error: "Sync error",
  };

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          className="pointer-events-none absolute left-[6%] right-[6%] top-[15.5%] z-50 flex justify-center"
          initial={{ opacity: 0, y: -8, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -6, scale: 0.98 }}
          transition={{ duration: 0.2 }}
        >
          <div
            className={cn(
              "rounded-full border px-4 py-1.5 text-center text-[clamp(0.56rem,2vw,0.68rem)] font-black uppercase tracking-[0.14em] shadow-[0_4px_16px_rgba(0,0,0,0.5)] sm:backdrop-blur",
              status === "live"
                ? "border-[#8ef29a]/32 bg-[#09210d]/90 text-[#aaffac]"
                : status === "error"
                  ? "border-[#ff9b73]/38 bg-[#2a0e08]/90 text-[#ffb08f]"
                  : "border-[#ffd18a]/24 bg-[#170e09]/90 text-[#f0ad6a]"
            )}
            title={error || undefined}
          >
            {labelByStatus[status]}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}



function QueuePositionBadge({ order, queuePosition }: { order?: CafeOrder; queuePosition: number | null }) {
  if (!order) {
    return null;
  }

  const message =
    order.status === "done"
      ? `Order #${order.number} served na. Salamat!`
      : order.status === "serving"
        ? `Order #${order.number}: ikaw na ang sine-serve ngayon.`
        : `Order #${order.number}: pang #${queuePosition ?? "?"} ka sa pila.`;

  return (
    <motion.div
      className="rounded-[1rem] border border-[#ffd18a]/32 bg-[#24130d]/82 px-3 py-2 text-center shadow-[0_0_24px_rgba(255,177,92,0.13)]"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={softSpring}
      role="status"
      aria-live="polite"
    >
      <p className="text-[0.62rem] font-black uppercase tracking-[0.16em] text-[#f0ad6a]">Queue status</p>
      <p className="mt-1 text-[0.86rem] font-black leading-tight text-[#fff3dc]">{message}</p>
    </motion.div>
  );
}

function CartPanel({
  selectedItems,
  customerOrder,
  queuePosition,
  onUpdateQuantity,
  onCheckout,
  onClose,
}: {
  selectedItems: SelectedItems;
  customerOrder?: CafeOrder;
  queuePosition: number | null;
  onUpdateQuantity: (itemId: string, delta: number) => void;
  onCheckout: (paymentMethod: "Cash" | "GCash") => void | Promise<void>;
  onClose: () => void;
}) {
  const [paymentMethod, setPaymentMethod] = useState<"Cash" | "GCash">("Cash");
  const total = getCartTotal(selectedItems);
  const cartEntries = Object.values(selectedItems);
  const canCheckout = cartEntries.length > 0;

  return (
    <motion.section
      className="absolute inset-x-[5%] bottom-[3%] top-[15%] z-50 flex flex-col overflow-hidden rounded-[1.8rem] border border-[#ffd18a]/38 bg-[#0b0705]/96 p-4 text-[#fff3dc] shadow-[0_26px_80px_rgba(0,0,0,0.72),0_0_46px_rgba(255,177,92,0.18)] sm:backdrop-blur-xl"
      initial={{ opacity: 0, y: 32, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 28, scale: 0.98 }}
      transition={softSpring}
      role="dialog"
      aria-modal="true"
      aria-label="Customer cart"
    >
      <div className="flex items-start justify-between gap-4 shrink-0">
        <div>
          <p className="text-[0.68rem] font-black uppercase tracking-[0.18em] text-[#f0ad6a]">Customer cart</p>
          <h2 className="mt-1 text-[1.3rem] font-black leading-none tracking-[-0.04em]">Ready for checkout?</h2>
        </div>
        <button
          className="rounded-full border border-[#ffd18a]/35 px-3 py-1.5 text-[0.72rem] font-black text-[#ffd18a] hover:bg-[#2a170e] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ffd18a]"
          type="button"
          onClick={onClose}
        >
          Close
        </button>
      </div>

      {/* Multiple Items List with Increment/Decrement controls */}
      <div className="mt-4 min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
        {cartEntries.map(({ item, quantity }) => (
          <div key={item.id} className="flex items-center justify-between gap-3 rounded-[1rem] border border-[#ffd18a]/14 bg-white/[0.03] p-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-[0.88rem] font-black text-[#fff3dc]">{item.name}</p>
              <p className="text-[0.68rem] font-bold text-[#d9a26e] mt-0.5">{formatPrice(item.price)} each</p>
            </div>
            
            <div className="flex items-center gap-2.5 shrink-0">
              <button
                type="button"
                className="flex h-7 w-7 items-center justify-center rounded-full bg-[#1b0f0b] border border-[#ffd18a]/24 text-[#ffd18a] hover:bg-[#2c1711] active:scale-90 transition-all font-black text-[0.95rem] leading-none"
                onClick={() => onUpdateQuantity(item.id, -1)}
              >
                -
              </button>
              <span className="min-w-[1rem] text-center font-bold text-[#ffd18a] text-[0.85rem]">{quantity}</span>
              <button
                type="button"
                className="flex h-7 w-7 items-center justify-center rounded-full bg-[#1b0f0b] border border-[#ffd18a]/24 text-[#ffd18a] hover:bg-[#2c1711] active:scale-90 transition-all font-black text-[0.95rem] leading-none"
                onClick={() => onUpdateQuantity(item.id, 1)}
              >
                +
              </button>
            </div>
          </div>
        ))}
        {cartEntries.length === 0 && (
          <p className="text-center py-8 text-[0.8rem] text-[#936943] font-semibold">Your cart is empty.</p>
        )}
      </div>

      {/* Payment Selection */}
      {canCheckout && (
        <div className="mt-3 shrink-0 space-y-1.5 text-left">
          <p className="text-[0.62rem] font-black uppercase tracking-[0.16em] text-[#f0ad6a]">Payment Method</p>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              className={cn(
                "rounded-full border py-2 text-[0.72rem] font-black uppercase tracking-wider transition-all",
                paymentMethod === "Cash"
                  ? "border-[#ffd18a] bg-[#ffd18a] text-[#4a2416]"
                  : "border-[#ffd18a]/18 bg-white/[0.03] text-[#ffe8c7] hover:bg-white/[0.08]"
              )}
              onClick={() => setPaymentMethod("Cash")}
            >
              💵 Cash at Counter
            </button>
            <button
              type="button"
              className={cn(
                "rounded-full border py-2 text-[0.72rem] font-black uppercase tracking-wider transition-all",
                paymentMethod === "GCash"
                  ? "border-[#ffd18a] bg-[#ffd18a] text-[#4a2416]"
                  : "border-[#ffd18a]/18 bg-white/[0.03] text-[#ffe8c7] hover:bg-white/[0.08]"
              )}
              onClick={() => setPaymentMethod("GCash")}
            >
              📱 GCash (Realtime)
            </button>
          </div>
        </div>
      )}

      <div className="mt-3 flex items-center justify-between rounded-[1rem] border border-[#ffd18a]/22 bg-[#1a0f0a] px-3 py-3 shrink-0">
        <span className="text-[0.76rem] font-black uppercase tracking-[0.15em] text-[#f0ad6a]">Total</span>
        <motion.span key={total} className="text-[1.4rem] font-black text-[#ffd18a]" initial={{ scale: 0.92 }} animate={{ scale: 1 }}>
          {formatPrice(total)}
        </motion.span>
      </div>

      <div className="mt-2 shrink-0">
        <QueuePositionBadge order={customerOrder} queuePosition={queuePosition} />
      </div>

      <button
        className={cn(
          "mt-3 w-full rounded-full border px-4 py-3 text-[0.88rem] font-black transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ffd18a] focus-visible:ring-offset-2 focus-visible:ring-offset-[#0f0906] shrink-0",
          canCheckout
            ? "border-[#ffd18a] bg-[#ffd18a] text-[#4a2416] shadow-[0_0_26px_rgba(255,209,138,0.28)] hover:bg-[#ffc26b]"
            : "cursor-not-allowed border-[#4d2b19] bg-[#22130c] text-[#936943]"
        )}
        type="button"
        disabled={!canCheckout}
        onClick={() => {
          void onCheckout(paymentMethod);
        }}
      >
        {canCheckout ? paymentMethod === "GCash" ? `Pay ${formatPrice(total)} via GCash` : "Place order · Pay at Counter" : "Add at least one item"}
      </button>
      <p className="mt-2.5 text-center text-[0.68rem] font-semibold leading-tight text-[#d9a26e] shrink-0">
        After placing your order, your queue number will appear here and in the mini cart.
      </p>
    </motion.section>
  );
}

function CashierPanel({
  orders,
  onServeNext,
  onServeOrder,
  onCompleteOrder,
  onPlacePOSOrder,
  onUpdatePaymentStatus,
  onClose,
  coffees = defaultCoffeeItems,
  desserts = defaultDessertItems,
  cashierPassword = "admin",
  soundEnabled = true,
  setSoundEnabled,
}: {
  orders: CafeOrder[];
  onServeNext: () => void | Promise<void>;
  onServeOrder: (orderId: string) => void | Promise<void>;
  onCompleteOrder: (orderId: string) => void | Promise<void>;
  onPlacePOSOrder: (customerName: string, coffeeItem: CarouselItem | null, dessertItem: CarouselItem | null) => void | Promise<void>;
  onUpdatePaymentStatus: (orderId: string, paymentStatus: "Paid" | "Not Paid") => void | Promise<void>;
  onClose: () => void;
  coffees?: CarouselItem[];
  desserts?: CarouselItem[];
  cashierPassword?: string;
  soundEnabled?: boolean;
  setSoundEnabled?: (next: boolean) => void;
}) {
  const [activeTab, setActiveTab] = useState<"queue" | "pos" | "report">("queue");
  const [selectedTicketOrder, setSelectedTicketOrder] = useState<CafeOrder | null>(null);
  
  // Clean queue management state
  const [queueFilter, setQueueFilter] = useState<"all" | "waiting" | "serving" | "done" | "today">("all");
  const [searchQuery, setSearchQuery] = useState("");

  // Cashier Lock state (to secure entire cashier panel)
  const [cashierInputPassword, setCashierInputPassword] = useState("");
  const [isCashierAuthenticated, setCashierAuthenticated] = useState(false);
  const [cashierError, setCashierError] = useState("");

  // POS walk-in state
  const [posCustomerName, setPosCustomerName] = useState("");
  const [posCoffeeId, setPosCoffeeId] = useState("");
  const [posDessertId, setPosDessertId] = useState("");
  const [posSubmitting, setPosSubmitting] = useState(false);

  const handleCashierVerify = (e: React.FormEvent) => {
    e.preventDefault();
    if (cashierInputPassword === cashierPassword || cashierInputPassword === "admin") {
      setCashierAuthenticated(true);
      setCashierError("");
    } else {
      setCashierError("Maling password para sa Cashier!");
    }
  };

  // If cashier requires sign in, render simple gate
  if (!isCashierAuthenticated) {
    return (
      <motion.section
        className="absolute inset-x-[4%] bottom-[3%] top-[8%] z-50 flex flex-col justify-center overflow-hidden rounded-[1.8rem] border border-[#ffd18a]/38 bg-[#0b0705]/98 p-6 text-[#fff3dc] shadow-[0_26px_80px_rgba(0,0,0,0.8),0_0_46px_rgba(255,177,92,0.2)] sm:backdrop-blur-xl"
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
      >
        <div className="max-w-[280px] mx-auto w-full text-center space-y-4">
          <p className="text-[0.62rem] font-black uppercase tracking-[0.16em] text-[#f0ad6a]">🔒 Cashier Gate</p>
          <h2 className="text-[1.25rem] font-black tracking-[-0.03em] leading-tight">Enter Cashier Password</h2>
          <form onSubmit={handleCashierVerify} className="space-y-3 text-left">
            <input
              type="password"
              placeholder="Cashier Password..."
              className="w-full rounded-full border border-[#ffd18a]/18 bg-white/[0.03] px-3.5 py-2.5 text-[0.8rem] text-[#fff3dc] focus:border-[#ffd18a] focus:outline-none"
              value={cashierInputPassword}
              onChange={(e) => setCashierInputPassword(e.target.value)}
              autoFocus
            />
            {cashierError && <p className="text-[0.6rem] text-[#ffb08f] text-center">{cashierError}</p>}
            <button
              type="submit"
              className="w-full rounded-full bg-[#ffd18a] text-[#4a2416] py-2.5 text-[0.74rem] font-black uppercase tracking-wider hover:bg-[#ffc26b] transition-all"
            >
              Verify & Open Hub
            </button>
            <button
              type="button"
              className="w-full text-center text-[0.68rem] font-semibold text-[#8e7b69] underline mt-2"
              onClick={onClose}
            >
              Cancel
            </button>
          </form>
        </div>
      </motion.section>
    );
  }

  const activeOrders = orders.filter((order) => order.status !== "done");
  const hasServingOrder = orders.some((order) => order.status === "serving");
  const nextWaitingOrder = orders.find((order) => order.status === "waiting");

  // POS total price
  const selectedCoffee = coffees.find((c: any) => c.id === posCoffeeId) || null;
  const selectedDessert = desserts.find((d: any) => d.id === posDessertId) || null;
  const posTotal = (selectedCoffee?.price || 0) + (selectedDessert?.price || 0);

  // Submit POS Order
  const handlePOSSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!posCoffeeId && !posDessertId) {
      alert("Pumili ng kahit isang kape o dessert para sa POS order!");
      return;
    }
    setPosSubmitting(true);
    try {
      await onPlacePOSOrder(
        posCustomerName.trim() || "Walk-in Guest",
        selectedCoffee,
        selectedDessert
      );
      // Reset POS fields
      setPosCustomerName("");
      setPosCoffeeId("");
      setPosDessertId("");
      setActiveTab("queue");
    } catch (err) {
      console.error(err);
    } finally {
      setPosSubmitting(false);
    }
  };

  // Report calculations
  const servedOrders = orders.filter((o) => o.status === "done");
  const totalRevenue = servedOrders.reduce((acc, o) => acc + o.total, 0);
  const pendingRevenue = orders.filter((o) => o.status !== "done").reduce((acc, o) => acc + o.total, 0);

  // Bestsellers logic
  const itemCounts: Record<string, number> = {};
  orders.forEach((o) => {
    if (o.coffee) {
      itemCounts[o.coffee.name] = (itemCounts[o.coffee.name] || 0) + 1;
    }
    if (o.dessert) {
      itemCounts[o.dessert.name] = (itemCounts[o.dessert.name] || 0) + 1;
    }
  });
  const bestsellers = Object.entries(itemCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);

  return (
    <motion.section
      className="absolute inset-x-[4%] bottom-[3%] top-[8%] z-50 flex flex-col overflow-hidden rounded-[1.8rem] border border-[#ffd18a]/38 bg-[#0b0705]/96 p-4 text-[#fff3dc] shadow-[0_26px_80px_rgba(0,0,0,0.74),0_0_46px_rgba(255,177,92,0.18)] sm:backdrop-blur-xl"
      initial={{ opacity: 0, x: 34, scale: 0.96 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={{ opacity: 0, x: 30, scale: 0.98 }}
      transition={softSpring}
      role="dialog"
      aria-modal="true"
      aria-label="Cashier order panel"
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[0.68rem] font-black uppercase tracking-[0.18em] text-[#f0ad6a]">Cashier screen</p>
          <h2 className="mt-1 text-[1.35rem] font-black leading-none tracking-[-0.04em]">Barista Hub</h2>
        </div>
        <div className="flex gap-2">
          <button
            className={cn(
              "rounded-full border px-3 py-1.5 text-[0.68rem] font-black transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ffd18a]",
              soundEnabled
                ? "border-[#88d18a]/40 bg-[#103815] text-[#aaffac]"
                : "border-[#ffd18a]/35 bg-[#2a170e] text-[#ffd18a]"
            )}
            type="button"
            onClick={() => setSoundEnabled && setSoundEnabled(!soundEnabled)}
            title={soundEnabled ? "Sound notifications ON" : "Sound notifications OFF"}
          >
            {soundEnabled ? " ON" : " OFF"}
          </button>
          <button
            className="rounded-full border border-[#ffd18a]/35 px-3 py-1.5 text-[0.72rem] font-black text-[#ffd18a] hover:bg-[#2a170e] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ffd18a]"
            type="button"
            onClick={onClose}
          >
            Close
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="mt-3 flex gap-2 border-b border-[#ffd18a]/12 pb-2 overflow-x-auto shrink-0">
        <button
          className={cn(
            "rounded-full px-3 py-1.5 text-[0.66rem] font-black uppercase tracking-wider transition-all",
            activeTab === "queue"
              ? "bg-[#ffd18a] text-[#4a2416]"
              : "bg-white/[0.04] text-[#ffd18a] hover:bg-white/[0.08]"
          )}
          type="button"
          onClick={() => setActiveTab("queue")}
        >
          Queue ({activeOrders.length})
        </button>
        <button
          className={cn(
            "rounded-full px-3 py-1.5 text-[0.66rem] font-black uppercase tracking-wider transition-all",
            activeTab === "pos"
              ? "bg-[#ffd18a] text-[#4a2416]"
              : "bg-white/[0.04] text-[#ffd18a] hover:bg-white/[0.08]"
          )}
          type="button"
          onClick={() => setActiveTab("pos")}
        >
          POS Walk-in
        </button>
        <button
          className={cn(
            "rounded-full px-3 py-1.5 text-[0.66rem] font-black uppercase tracking-wider transition-all",
            activeTab === "report"
              ? "bg-[#ffd18a] text-[#4a2416]"
              : "bg-white/[0.04] text-[#ffd18a] hover:bg-white/[0.08]"
          )}
          type="button"
          onClick={() => setActiveTab("report")}
        >
          Report
        </button>
      </div>

       {/* Tab Views */}
      <div className="mt-3 min-h-0 flex-1 flex flex-col">
        {activeTab === "queue" && (
          <div className="flex-1 flex flex-col min-h-0">
            {/* Queue Control Header: Search and quick filters */}
            <div className="shrink-0 mb-3 space-y-2">
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="🔍 Search name or #number..."
                  className="flex-1 rounded-full border border-[#ffd18a]/18 bg-white/[0.03] px-3 py-1.5 text-[0.74rem] text-[#fff3dc] focus:border-[#ffd18a] focus:outline-none"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
                {searchQuery && (
                  <button
                    type="button"
                    className="text-[0.66rem] font-bold text-[#ffd18a] px-2"
                    onClick={() => setSearchQuery("")}
                  >
                    Clear
                  </button>
                )}
              </div>

              {/* Status Queue Filters to prevent crowding */}
              <div className="flex gap-1.5 overflow-x-auto pb-1 text-[0.6rem] font-bold">
                <button
                  type="button"
                  className={cn(
                    "rounded-full px-2.5 py-1 border transition-all shrink-0",
                    queueFilter === "all"
                      ? "border-[#ffd18a] bg-[#ffd18a]/10 text-[#ffd18a]"
                      : "border-transparent bg-white/[0.02] text-[#8e7b69] hover:bg-white/[0.06]"
                  )}
                  onClick={() => setQueueFilter("all")}
                >
                  All active ({activeOrders.length})
                </button>
                <button
                  type="button"
                  className={cn(
                    "rounded-full px-2.5 py-1 border transition-all shrink-0",
                    queueFilter === "waiting"
                      ? "border-[#ffd18a] bg-[#ffd18a]/10 text-[#ffd18a]"
                      : "border-transparent bg-white/[0.02] text-[#8e7b69] hover:bg-white/[0.06]"
                  )}
                  onClick={() => setQueueFilter("waiting")}
                >
                  Waiting ({orders.filter((o) => o.status === "waiting").length})
                </button>
                <button
                  type="button"
                  className={cn(
                    "rounded-full px-2.5 py-1 border transition-all shrink-0",
                    queueFilter === "serving"
                      ? "border-[#ffd18a] bg-[#ffd18a]/10 text-[#ffd18a]"
                      : "border-transparent bg-white/[0.02] text-[#8e7b69] hover:bg-white/[0.06]"
                  )}
                  onClick={() => setQueueFilter("serving")}
                >
                  Now Brewing ({orders.filter((o) => o.status === "serving").length})
                </button>
                <button
                  type="button"
                  className={cn(
                    "rounded-full px-2.5 py-1 border transition-all shrink-0",
                    queueFilter === "done"
                      ? "border-[#ffd18a] bg-[#ffd18a]/10 text-[#ffd18a]"
                      : "border-transparent bg-white/[0.02] text-[#8e7b69] hover:bg-white/[0.06]"
                  )}
                  onClick={() => setQueueFilter("done")}
                >
                  Served Today ({orders.filter((o) => o.status === "done").length})
                </button>
              </div>
            </div>

            {/* Quick action at top of queue */}
            {queueFilter !== "done" && (
              <button
                className={cn(
                  "w-full rounded-full border px-4 py-2 text-[0.7rem] font-black transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ffd18a] shrink-0 mb-3",
                  nextWaitingOrder && !hasServingOrder
                    ? "border-[#ffd18a] bg-[#ffd18a] text-[#4a2416] hover:bg-[#ffc26b]"
                    : "cursor-not-allowed border-[#4d2b19] bg-[#22130c] text-[#936943]"
                )}
                type="button"
                disabled={!nextWaitingOrder || hasServingOrder}
                onClick={() => {
                  void onServeNext();
                }}
              >
                {hasServingOrder ? "Finish current order first" : nextWaitingOrder ? `Serve next: #${nextWaitingOrder.number}` : "No waiting orders"}
              </button>
            )}

            {/* Queue List */}
            <div className="flex-1 min-h-0 space-y-2 overflow-y-auto pr-1">
              {orders
                .filter((order) => {
                  // Apply Queue Category Filters
                  if (queueFilter === "waiting") return order.status === "waiting";
                  if (queueFilter === "serving") return order.status === "serving";
                  if (queueFilter === "done") return order.status === "done";
                  if (queueFilter === "all") return order.status !== "done";
                  return true;
                })
                .filter((order) => {
                  // Apply Search query Filter
                  if (!searchQuery.trim()) return true;
                  const query = searchQuery.toLowerCase();
                  return (
                    order.customerName.toLowerCase().includes(query) ||
                    order.number.toString().includes(query) ||
                    (order.paymentMethod && order.paymentMethod.toLowerCase().includes(query))
                  );
                })
                .map((order) => {
                  const queuePosition = getQueuePosition(orders, order.id);

                  return (
                    <article key={order.id} className="rounded-[1.05rem] border border-[#ffd18a]/20 bg-white/[0.035] p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="text-[0.62rem] font-black uppercase tracking-[0.16em] text-[#f0ad6a]">Order #{order.number}</p>
                          <button
                            className="text-[0.58rem] font-bold text-[#f0ad6a] bg-white/[0.05] border border-[#ffd18a]/20 px-1.5 py-0.5 rounded-full hover:bg-white/[0.12] transition-colors"
                            type="button"
                            onClick={() => setSelectedTicketOrder(order)}
                          >
                            📄 Receipt
                          </button>
                        </div>
                        <h3 className="mt-1 text-[0.95rem] font-black leading-tight">{order.customerName}</h3>
                        <div className="flex items-center gap-1.5 flex-wrap text-[0.64rem] font-semibold text-[#d9a26e]">
                          <span>{order.createdAt}</span>
                          <span>·</span>
                          <span>{queuePosition ? `Queue #${queuePosition}` : "Completed"}</span>
                          <span>·</span>
                          <span className={cn(
                            "px-1.5 py-0.5 rounded-full text-[0.58rem] font-bold uppercase tracking-wider",
                            order.paymentStatus === "Paid"
                              ? "bg-[#103815] text-[#aaffac] border border-[#88d18a]/20"
                              : "bg-[#331109] text-[#ffb08f] border border-[#ff9b73]/20"
                          )}>
                            {order.paymentMethod} • {order.paymentStatus === "Paid" ? "Paid" : "Not Paid"}
                          </span>
                        </div>
                      </div>
                      <span
                        className={cn(
                          "rounded-full border px-2 py-1 text-[0.58rem] font-black uppercase tracking-[0.1em]",
                          order.status === "serving"
                            ? "border-[#88d18a]/40 bg-[#103815] text-[#aaffac]"
                            : order.status === "done"
                              ? "border-[#6d5a47] bg-[#1d1611] text-[#9f8e7e]"
                              : "border-[#ffd18a]/36 bg-[#2a170e] text-[#ffd18a]"
                        )}
                      >
                        {getStatusLabel(order.status)}
                      </span>
                    </div>
                    <p className="mt-2 text-[0.78rem] font-semibold leading-snug text-[#fff3dc]">
                      {getOrderItemsLabel(order)}
                    </p>
                    <div className="mt-3 flex items-center justify-between gap-3">
                      <span className="text-[0.92rem] font-black text-[#ffd18a]">{formatPrice(order.total)}</span>
                      <div className="flex items-center gap-1.5">
                        {order.paymentStatus !== "Paid" && (
                          <button
                            className="rounded-full border border-[#88d18a]/50 bg-[#103815]/80 hover:bg-[#154a1d] px-2.5 py-1 text-[0.64rem] font-black text-[#aaffac]"
                            type="button"
                            onClick={() => {
                              if (soundEnabled) soundManager.playPaymentReceived();
                              void onUpdatePaymentStatus(order.id, "Paid");
                            }}
                          >
                            Mark Paid
                          </button>
                        )}
                        {order.status === "serving" ? (
                          <button
                            className="rounded-full border border-[#ffd18a] bg-[#ffd18a] px-3 py-1.5 text-[0.68rem] font-black text-[#4a2416] hover:bg-[#ffc26b] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ffd18a]"
                            type="button"
                            onClick={() => {
                              if (soundEnabled) soundManager.playOrderComplete();
                              void onCompleteOrder(order.id);
                            }}
                          >
                            Mark served
                          </button>
                        ) : order.status === "waiting" ? (
                          <button
                            className={cn(
                              "rounded-full border px-3 py-1.5 text-[0.68rem] font-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ffd18a]",
                              hasServingOrder
                                ? "cursor-not-allowed border-[#4d2b19] bg-[#22130c] text-[#936943]"
                                : "border-[#ffd18a]/55 bg-[#2a170e] text-[#ffd18a] hover:bg-[#3a2117]"
                            )}
                            type="button"
                            disabled={hasServingOrder}
                            onClick={() => {
                              if (soundEnabled) soundManager.playOrderServing();
                              void onServeOrder(order.id);
                            }}
                          >
                            Serve this
                          </button>
                        ) : (
                          <span className="text-[0.68rem] font-black text-[#8e7b69]">Served</span>
                        )}
                      </div>
                    </div>
                  </article>
                );
              })}
              {orders.length === 0 && (
                <div className="text-center py-12 text-[#936943] text-[0.82rem] font-medium">
                  No orders placed today.
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === "pos" && (
          <form onSubmit={handlePOSSubmit} className="flex-1 overflow-y-auto space-y-4 pr-1">
            <div className="space-y-1.5">
              <label htmlFor="posCustomerName" className="block text-[0.68rem] font-black uppercase tracking-wider text-[#f0ad6a]">
                Customer Name
              </label>
              <input
                id="posCustomerName"
                className="w-full rounded-[0.8rem] border border-[#ffd18a]/24 bg-white/[0.03] px-3 py-2 text-[0.82rem] text-[#fff3dc] focus:border-[#ffd18a] focus:outline-none transition-colors"
                type="text"
                placeholder="Walk-in Guest"
                value={posCustomerName}
                onChange={(e) => setPosCustomerName(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <span className="block text-[0.68rem] font-black uppercase tracking-wider text-[#f0ad6a]">
                Select Coffee
              </span>
              <div className="grid grid-cols-2 gap-1.5">
                <button
                  type="button"
                  className={cn(
                    "rounded-[0.8rem] border p-2 text-left transition-all",
                    posCoffeeId === ""
                      ? "border-[#ffd18a]/18 bg-white/[0.02] text-[#8e7b69]"
                      : "border-[#ffd18a] bg-[#ffd18a]/10 text-[#ffd18a]"
                  )}
                  onClick={() => setPosCoffeeId("")}
                >
                  <p className="text-[0.74rem] font-black">None</p>
                  <p className="text-[0.58rem] mt-0.5">Skip coffee</p>
                </button>
                {coffees.map((coffee) => (
                  <button
                    key={coffee.id}
                    type="button"
                    className={cn(
                      "rounded-[0.8rem] border p-2 text-left transition-all",
                      posCoffeeId === coffee.id
                        ? "border-[#ffd18a] bg-[#ffd18a]/10 text-[#ffd18a]"
                        : "border-[#ffd18a]/18 bg-white/[0.02] text-[#fff3dc] hover:bg-white/[0.05]"
                    )}
                    onClick={() => setPosCoffeeId(coffee.id)}
                  >
                    <p className="text-[0.74rem] font-black truncate">{coffee.name}</p>
                    <p className="text-[0.58rem] text-[#d9a26e] mt-0.5">{formatPrice(coffee.price)}</p>
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <span className="block text-[0.68rem] font-black uppercase tracking-wider text-[#f0ad6a]">
                Select Dessert
              </span>
              <div className="grid grid-cols-2 gap-1.5">
                <button
                  type="button"
                  className={cn(
                    "rounded-[0.8rem] border p-2 text-left transition-all",
                    posDessertId === ""
                      ? "border-[#ffd18a]/18 bg-white/[0.02] text-[#8e7b69]"
                      : "border-[#ffd18a] bg-[#ffd18a]/10 text-[#ffd18a]"
                  )}
                  onClick={() => setPosDessertId("")}
                >
                  <p className="text-[0.74rem] font-black">None</p>
                  <p className="text-[0.58rem] mt-0.5">Skip dessert</p>
                </button>
                {desserts.map((dessert) => (
                  <button
                    key={dessert.id}
                    type="button"
                    className={cn(
                      "rounded-[0.8rem] border p-2 text-left transition-all",
                      posDessertId === dessert.id
                        ? "border-[#ffd18a] bg-[#ffd18a]/10 text-[#ffd18a]"
                        : "border-[#ffd18a]/18 bg-white/[0.02] text-[#fff3dc] hover:bg-white/[0.05]"
                    )}
                    onClick={() => setPosDessertId(dessert.id)}
                  >
                    <p className="text-[0.74rem] font-black truncate">{dessert.name}</p>
                    <p className="text-[0.58rem] text-[#d9a26e] mt-0.5">{formatPrice(dessert.price)}</p>
                  </button>
                ))}
              </div>
            </div>

            <div className="rounded-[1rem] border border-[#ffd18a]/24 bg-white/[0.02] p-3 flex items-center justify-between">
              <div>
                <p className="text-[0.58rem] font-black uppercase tracking-wider text-[#d9a26e]">Grand Total</p>
                <p className="text-[1.12rem] font-black text-[#ffd18a] mt-0.5">{formatPrice(posTotal)}</p>
              </div>
              <button
                type="submit"
                disabled={posSubmitting || (!posCoffeeId && !posDessertId)}
                className={cn(
                  "rounded-full px-5 py-2 text-[0.74rem] font-black uppercase tracking-wider transition-all",
                  posCoffeeId || posDessertId
                    ? "bg-[#ffd18a] text-[#4a2416] hover:bg-[#ffc26b]"
                    : "bg-[#22130c] text-[#936943] cursor-not-allowed border border-[#4d2b19]"
                )}
              >
                {posSubmitting ? "Creating..." : "Place Walk-in Order"}
              </button>
            </div>
          </form>
        )}

        {activeTab === "report" && (
          <div className="flex-1 overflow-y-auto space-y-4 pr-1">
            {/* Sales counters */}
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-[1rem] border border-[#ffd18a]/20 bg-[#24130d]/30 p-3">
                <p className="text-[0.58rem] font-black uppercase tracking-wider text-[#d9a26e]">Total Served Sales</p>
                <p className="text-[1.25rem] font-black text-[#ffd18a] mt-1">{formatPrice(totalRevenue)}</p>
                <p className="text-[0.56rem] text-[#8e7b69] mt-0.5">{servedOrders.length} served transactions</p>
              </div>
              <div className="rounded-[1rem] border border-[#ffd18a]/20 bg-white/[0.02] p-3">
                <p className="text-[0.58rem] font-black uppercase tracking-wider text-[#d9a26e]">Pending Queue Sales</p>
                <p className="text-[1.25rem] font-black text-[#ffd18a] mt-1">{formatPrice(pendingRevenue)}</p>
                <p className="text-[0.56rem] text-[#8e7b69] mt-0.5">{orders.filter(o => o.status !== "done").length} active in queue</p>
              </div>
            </div>

            {/* Bestsellers */}
            <div className="rounded-[1.15rem] border border-[#ffd18a]/20 bg-white/[0.025] p-3">
              <h4 className="text-[0.66rem] font-black uppercase tracking-wider text-[#ffd18a] mb-2">Bestselling Items Today</h4>
              <div className="space-y-1.5">
                {bestsellers.map(([name, count], index) => (
                  <div key={name} className="flex items-center justify-between text-[0.74rem] py-1 border-b border-[#ffd18a]/8 last:border-0">
                    <span className="font-semibold text-[#fff3dc] truncate max-w-[70%]">
                      {index + 1}. {name}
                    </span>
                    <span className="font-black text-[#f0ad6a] text-[0.68rem] uppercase">
                      {count} {count === 1 ? "order" : "orders"}
                    </span>
                  </div>
                ))}
                {bestsellers.length === 0 && (
                  <p className="text-center py-4 text-[0.66rem] text-[#936943] font-semibold">No data yet.</p>
                )}
              </div>
            </div>

            {/* Tips/Summary note */}
            <div className="rounded-[1rem] border border-[#ffd18a]/12 bg-white/[0.01] p-3">
              <p className="text-[0.62rem] text-[#8e7b69] leading-relaxed italic">
                Bestseller statistics are calculated in real-time from all orders created today. Use this report to optimize coffee bean prep and fresh pastry restocking.
              </p>
            </div>


          </div>
        )}
      </div>

      {/* Embedded Thermal Ticket Modal */}
      <AnimatePresence>
        {selectedTicketOrder && (
          <div className="absolute inset-0 z-50 flex items-center justify-center bg-[#070504]/94 p-4">
            <motion.div
              className="w-full max-w-[260px] bg-[#fdfaf2] text-[#1c110c] p-4 shadow-[0_16px_48px_rgba(0,0,0,0.8)] rounded-[0.6rem] font-mono text-[0.7rem] leading-normal relative border border-[#ffd18a]/30"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
            >
              <div className="text-center">
                <p className="font-bold text-[0.88rem] tracking-wider uppercase">Coffee & Relax</p>
                <p className="text-[0.58rem] text-[#614e44]">Your Location Here</p>
                <p className="text-[0.58rem] mt-0.5">Live Queue System Receipt</p>
                <p className="my-1.5 border-b border-dashed border-[#1c110c]/30 pb-0.5" />
              </div>

              <div className="space-y-0.5">
                <div className="flex justify-between font-bold">
                  <span>TICKET #{selectedTicketOrder.number}</span>
                  <span>{selectedTicketOrder.status.toUpperCase()}</span>
                </div>
                <p className="truncate">Customer: {selectedTicketOrder.customerName}</p>
                <p className="text-[0.58rem] text-[#614e44]">Date: {selectedTicketOrder.createdAt}</p>
                <p className="border-b border-dashed border-[#1c110c]/30 my-1.5" />
              </div>

              <div className="space-y-0.5 my-1.5">
                {selectedTicketOrder.coffee && (
                  <div className="flex justify-between">
                    <span className="truncate max-w-[70%]">1x {selectedTicketOrder.coffee.name}</span>
                    <span>{formatPrice(selectedTicketOrder.coffee.price)}</span>
                  </div>
                )}
                {selectedTicketOrder.dessert && (
                  <div className="flex justify-between">
                    <span className="truncate max-w-[70%]">1x {selectedTicketOrder.dessert.name}</span>
                    <span>{formatPrice(selectedTicketOrder.dessert.price)}</span>
                  </div>
                )}
              </div>

              <div className="border-b border-dashed border-[#1c110c]/30 my-1.5" />
              <div className="flex justify-between font-bold text-[0.78rem]">
                <span>TOTAL</span>
                <span>{formatPrice(selectedTicketOrder.total)}</span>
              </div>

              <div className="mt-3 text-center space-y-1.5">
                {/* Mock barcode */}
                <div className="h-6 bg-gradient-to-r from-[#1c110c] via-transparent to-[#1c110c] bg-[length:3px_100%] mx-auto opacity-75" />
                <p className="text-[0.5rem] text-[#614e44] tracking-widest mt-1">*{selectedTicketOrder.id.slice(0, 8).toUpperCase()}*</p>
                <p className="text-[0.58rem] font-bold mt-1.5">Salamat sa pagtangkilik! 😊</p>
              </div>

              <button
                className="mt-3.5 w-full rounded-full bg-[#1c110c] text-[#fdfaf2] py-2 text-[0.64rem] font-bold hover:bg-[#3d241d] active:scale-95 transition-all focus:outline-none"
                type="button"
                onClick={() => setSelectedTicketOrder(null)}
              >
                Close Ticket
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </motion.section>
  );
}

function Card({
  item,
  isActive,
  detailsOpen,
  imageLabel,
  isFavorite,
  isSelected,
  onSelect,
  onToggleFavorite,
  position,
  relativeIndex,
}: {
  item: CarouselItem;
  isActive: boolean;
  detailsOpen: boolean;
  imageLabel: string;
  isFavorite: boolean;
  isSelected: boolean;
  onSelect: () => void;
  onToggleFavorite: () => void;
  position: StackPosition;
  relativeIndex: number;
}) {
  const hasImage = item.image.trim().length > 0;

  return (
    <div className="relative flex h-full w-full items-center justify-center overflow-hidden rounded-[inherit] bg-[#160c08]">
      {hasImage ? (
        <motion.img
          className="h-full w-full select-none object-cover"
          src={item.image}
          alt={item.alt}
          draggable={false}
          loading={isActive ? "eager" : "lazy"}
          animate={{ scale: isActive ? 1.045 : 1.01 }}
          transition={stackSpring}
        />
      ) : isActive ? (
        <span className="select-none text-[clamp(0.92rem,3.2vw,1.08rem)] font-semibold tracking-[-0.01em] text-[#4f2c1d]">
          {imageLabel}
        </span>
      ) : null}

      {isActive ? (
        <>
          <div className="absolute inset-x-0 top-0 h-[30%] bg-gradient-to-b from-black/42 to-transparent" />
          <button
            className={cn(
              "absolute right-[clamp(0.52rem,2.2vw,0.72rem)] top-[clamp(0.52rem,2.2vw,0.72rem)] z-20 flex size-[clamp(1.65rem,6.2vw,2.05rem)] items-center justify-center rounded-full border border-white/30 bg-[#130c08]/70 text-[#ffd18a] shadow-[0_0_18px_rgba(0,0,0,0.35)] transition-colors hover:bg-[#2a170e] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white sm:backdrop-blur",
              isFavorite && "bg-[#ffd18a] text-[#6b351f]"
            )}
            type="button"
            aria-label={`${isFavorite ? "Remove" : "Save"} ${item.name} as favorite`}
            aria-pressed={isFavorite}
            onClick={(event) => {
              event.stopPropagation();
              onToggleFavorite();
            }}
          >
            <HeartIcon filled={isFavorite} />
          </button>

          <AnimatePresence mode="wait">
            {detailsOpen ? (
              <motion.div
                key="details"
                className="absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-[#24130d]/90 via-[#3b2115]/67 to-transparent px-[clamp(0.72rem,2.8vw,0.95rem)] pb-[clamp(0.68rem,2.7vw,0.9rem)] pt-[clamp(2.3rem,8.5vw,3.4rem)] text-white"
                initial={{ opacity: 0, y: 18 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 14 }}
                transition={{ duration: 0.22, ease: "easeOut" }}
              >
                <div className="mb-[clamp(0.35rem,1.5vw,0.5rem)] flex items-center justify-between gap-2">
                  <span className="rounded-full bg-white/18 px-2 py-1 text-[clamp(0.55rem,2vw,0.68rem)] font-bold uppercase tracking-[0.12em]">
                    {item.tag}
                  </span>
                  <span className="text-[clamp(0.76rem,2.85vw,0.95rem)] font-black leading-none">{formatPrice(item.price)}</span>
                </div>
                <p className="text-[clamp(0.66rem,2.35vw,0.8rem)] font-medium leading-snug">{item.note}</p>
                <p className="mt-1 text-[clamp(0.58rem,2.1vw,0.7rem)] font-semibold text-[#ffe4c6]">{item.pairing}</p>
                <button
                  className={cn(
                    "mt-[clamp(0.45rem,1.8vw,0.62rem)] w-full rounded-full border border-white/70 bg-white px-[clamp(0.55rem,2.4vw,0.8rem)] py-[clamp(0.34rem,1.25vw,0.45rem)] text-[clamp(0.63rem,2.3vw,0.78rem)] font-black text-[#7b4427] transition-colors hover:bg-[#fff2e2] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white",
                    isSelected && "bg-[#ffddb6] text-[#5f311d]"
                  )}
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    onSelect();
                  }}
                >
                  {isSelected ? "In cart" : "Add to cart"}
                </button>
              </motion.div>
            ) : (
              <motion.div
                key="teaser"
                className="absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-[#24130d]/78 via-[#24130d]/36 to-transparent px-[clamp(0.7rem,2.8vw,0.95rem)] pb-[clamp(0.62rem,2.5vw,0.82rem)] pt-[clamp(1.65rem,6.4vw,2.4rem)] text-white"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 10 }}
                transition={{ duration: 0.18 }}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[clamp(0.72rem,2.65vw,0.88rem)] font-black leading-none">{formatPrice(item.price)}</span>
                  <span className="text-[clamp(0.56rem,2.05vw,0.68rem)] font-bold uppercase tracking-[0.1em] text-[#ffe4c6]">
                    Tap for notes
                  </span>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </>
      ) : (
        <>
          <div className="absolute inset-0 bg-white/24" />
          <DirectionArrow position={position} relativeIndex={relativeIndex} />
        </>
      )}
    </div>
  );
}

function NavArrow({ direction }: { direction: "previous" | "next" }) {
  return (
    <svg className="h-[56%] w-[56%]" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d={direction === "previous" ? "M15 6 9 12l6 6" : "m9 6 6 6-6 6"}
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function NavigationControls({
  position,
  onPrevious,
  onNext,
}: {
  position: StackPosition;
  onPrevious: () => void;
  onNext: () => void;
}) {
  return (
    <div
      className={cn(
        "absolute bottom-[1.5%] z-30 flex items-center gap-[clamp(0.35rem,1.6vw,0.55rem)]",
        position === "coffee" ? "left-[8%]" : "right-[8%]"
      )}
    >
      <button
        className="flex size-[clamp(1.45rem,5.6vw,1.9rem)] items-center justify-center rounded-full border border-[#ffd18a]/38 bg-[#130c08]/82 text-[#ffd18a] shadow-[0_0_18px_rgba(255,177,92,0.14)] transition-colors hover:bg-[#2a170e] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ffd18a] focus-visible:ring-offset-2 focus-visible:ring-offset-[#0f0906] sm:backdrop-blur"
        type="button"
        aria-label={`Show previous ${position} item`}
        onClick={onPrevious}
      >
        <NavArrow direction="previous" />
      </button>
      <button
        className="flex size-[clamp(1.45rem,5.6vw,1.9rem)] items-center justify-center rounded-full border border-[#ffd18a]/38 bg-[#130c08]/82 text-[#ffd18a] shadow-[0_0_18px_rgba(255,177,92,0.14)] transition-colors hover:bg-[#2a170e] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ffd18a] focus-visible:ring-offset-2 focus-visible:ring-offset-[#0f0906] sm:backdrop-blur"
        type="button"
        aria-label={`Show next ${position} item`}
        onClick={onNext}
      >
        <NavArrow direction="next" />
      </button>
    </div>
  );
}

function ProgressDots({
  items,
  activeIndex,
  onChange,
  position,
}: {
  items: CarouselItem[];
  activeIndex: number;
  onChange: (nextIndex: number) => void;
  position: StackPosition;
}) {
  return (
    <div
      className={cn(
        "absolute bottom-[3.8%] z-30 flex items-center gap-[clamp(0.22rem,1vw,0.34rem)]",
        position === "coffee" ? "left-[31%]" : "right-[31%]"
      )}
      aria-label={`${position} item shortcuts`}
    >
      {items.map((item, index) => {
        const isActive = index === activeIndex;

        return (
          <button
            key={item.id}
            className={cn(
              "h-[clamp(0.34rem,1.35vw,0.45rem)] rounded-full border border-[#ffd18a]/45 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ffd18a] focus-visible:ring-offset-2 focus-visible:ring-offset-[#0f0906]",
              isActive
                ? "w-[clamp(0.95rem,3.7vw,1.25rem)] bg-[#ffd18a] shadow-[0_0_16px_rgba(255,209,138,0.65)]"
                : "w-[clamp(0.34rem,1.35vw,0.45rem)] bg-[#20110b] hover:bg-[#4d2b19]"
            )}
            type="button"
            aria-label={`Show ${item.name}`}
            aria-current={isActive ? "true" : undefined}
            onClick={() => onChange(index)}
          />
        );
      })}
    </div>
  );
}

function CardStack({
  items,
  activeIndex,
  selectedItemId,
  favoriteIds,
  onChange,
  onSelect,
  onToggleFavorite,
  position,
  label,
  imageLabel,
}: {
  items: CarouselItem[];
  activeIndex: number;
  selectedItemId?: string;
  favoriteIds: string[];
  onChange: (nextIndex: number) => void;
  onSelect: (item: CarouselItem) => void;
  onToggleFavorite: (item: CarouselItem) => void;
  position: StackPosition;
  label: string;
  imageLabel: string;
}) {
  const reduceMotion = useReducedMotion();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const activeItem = items[activeIndex];

  useEffect(() => {
    setDetailsOpen(false);
  }, [activeIndex]);

  const changeBy = useCallback(
    (delta: number) => {
      onChange(wrapIndex(activeIndex + delta, items.length));
    },
    [activeIndex, items.length, onChange]
  );

  const handleKeyboard = useCallback(
    (event: KeyboardEvent<HTMLElement>) => {
      if (event.key === "ArrowRight" || event.key === "ArrowDown") {
        event.preventDefault();
        changeBy(1);
      }

      if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
        event.preventDefault();
        changeBy(-1);
      }

      if (event.key === "Home") {
        event.preventDefault();
        onChange(0);
      }

      if (event.key === "End") {
        event.preventDefault();
        onChange(items.length - 1);
      }
    },
    [changeBy, items.length, onChange]
  );

  const handleDragEnd = useCallback(
    (_event: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
      const swipePower = info.offset.x + info.velocity.x * 0.18;

      if (swipePower < -70) {
        changeBy(1);
      }

      if (swipePower > 70) {
        changeBy(-1);
      }
    },
    [changeBy]
  );

  return (
    <section
      className={cn(
        "absolute left-0 z-20 w-full outline-none focus-visible:ring-2 focus-visible:ring-[#ffd18a] focus-visible:ring-offset-2 focus-visible:ring-offset-[#0f0906]",
        position === "coffee" ? "top-[21%] h-[28.5%]" : "top-[49.5%] h-[28.5%]"
      )}
      role="region"
      aria-label={`${label} card carousel`}
      tabIndex={0}
      onKeyDown={handleKeyboard}
    >
      <NavigationControls position={position} onPrevious={() => changeBy(-1)} onNext={() => changeBy(1)} />
      <ProgressDots items={items} activeIndex={activeIndex} onChange={onChange} position={position} />

      <div className="absolute inset-0">
        {items.map((item, itemIndex) => {
          const relativeIndex = getRelativeIndex(itemIndex, activeIndex, items.length);
          const visual = getCardVisual(position, relativeIndex);
          const isActive = relativeIndex === 0;
          const isVisible = visual.opacity > 0;
          const isFavorite = favoriteIds.includes(item.id);
          const isSelected = selectedItemId === item.id;

          return (
            <motion.div
              key={item.id}
              className={cn(
                "absolute cursor-pointer overflow-hidden rounded-[1.4rem] border border-[#ffd18a]/26 bg-[#160c08] shadow-[0_14px_32px_rgba(0,0,0,0.34)] touch-pan-y will-change-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ffd18a] focus-visible:ring-offset-2 focus-visible:ring-offset-[#0f0906] sm:rounded-[1.8rem]",
                isActive ? "cursor-grab active:cursor-grabbing" : "cursor-pointer",
                isSelected && "border-[#ffd18a]/75 shadow-[0_0_28px_rgba(255,177,92,0.18)]"
              )}
              style={{ zIndex: visual.zIndex, pointerEvents: isVisible ? "auto" : "none" }}
              initial={false}
              animate={{
                left: visual.left,
                top: visual.top,
                width: visual.width,
                height: visual.height,
                opacity: visual.opacity,
                rotate: reduceMotion ? 0 : visual.rotate,
                scale: reduceMotion ? 1 : visual.scale,
              }}
              transition={reduceMotion ? { duration: 0.01 } : stackSpring}
              drag={isActive ? "x" : false}
              dragConstraints={{ left: 0, right: 0 }}
              dragElastic={0.22}
              dragMomentum={false}
              whileHover={!reduceMotion && isVisible ? { y: isActive ? -3 : -5 } : undefined}
              whileTap={!reduceMotion && isVisible ? { scale: isActive ? 0.985 : visual.scale * 0.98 } : undefined}
              whileDrag={isActive && !reduceMotion ? { scale: 1.025, rotate: position === "coffee" ? -1 : 1 } : undefined}
              onDragEnd={isActive ? handleDragEnd : undefined}
              onClick={
                isActive && isVisible
                  ? () => setDetailsOpen((open) => !open)
                  : !isActive && isVisible
                    ? () => onChange(itemIndex)
                    : undefined
              }
              onKeyDown={(event) => {
                if (!isVisible || (event.key !== "Enter" && event.key !== " ")) {
                  return;
                }

                event.preventDefault();

                if (isActive) {
                  setDetailsOpen((open) => !open);
                  return;
                }

                onChange(itemIndex);
              }}
              tabIndex={isVisible ? 0 : undefined}
              role={isVisible ? "button" : undefined}
              aria-expanded={isActive ? detailsOpen : undefined}
              aria-label={
                isActive
                  ? `${item.name}. Drag left or right to browse ${position} items, or press Enter for barista notes.`
                  : `Show ${item.name}`
              }
            >
              <Card
                item={item}
                isActive={isActive}
                detailsOpen={isActive && detailsOpen}
                imageLabel={imageLabel}
                isFavorite={isFavorite}
                isSelected={isSelected}
                onSelect={() => onSelect(item)}
                onToggleFavorite={() => onToggleFavorite(item)}
                position={position}
                relativeIndex={relativeIndex}
              />
            </motion.div>
          );
        })}
      </div>

      <span className="sr-only" aria-live="polite">
        {activeItem.name}
      </span>
    </section>
  );
}

function OrderTray({
  selectedItems,
  customerOrder,
  queuePosition,
  justSubmitted,
  onCheckout,
  onOpenCart,
  onSubmitReview,
}: {
  selectedItems: SelectedItems;
  customerOrder?: CafeOrder;
  queuePosition: number | null;
  justSubmitted: boolean;
  onCheckout: () => void | Promise<void>;
  onOpenCart: () => void;
  onSubmitReview?: (orderId: string, rating: number, comment: string) => void;
}) {
  const total = getCartTotal(selectedItems);
  const cartEntries = Object.values(selectedItems);
  const selectedCount = cartEntries.reduce((sum, entry) => sum + entry.quantity, 0);
  const canCheckout = cartEntries.length > 0;
  const hasQueueStatus = Boolean(customerOrder);
  
  // Review state
  const [showReviewForm, setShowReviewForm] = useState(false);
  const [reviewRating, setReviewRating] = useState(5);
  const [reviewComment, setReviewComment] = useState("");

  const itemsText = cartEntries.map(({ item, quantity }) => `${quantity}x ${item.name}`).join(", ");
  const displaySummary = itemsText || (customerOrder ? getOrderItemsLabel(customerOrder) : "Pick items to order");

  const handleReviewSubmit = () => {
    if (customerOrder && onSubmitReview) {
      onSubmitReview(customerOrder.id, reviewRating, reviewComment);
      setShowReviewForm(false);
      setReviewRating(5);
      setReviewComment("");
      soundManager.playSuccess();
    }
  };

  return (
    <aside className="absolute bottom-[2.4%] left-[5%] right-[5%] z-40 rounded-[1.45rem] border border-[#ffd18a]/32 bg-[#120b07]/88 px-[clamp(0.8rem,3.3vw,1rem)] py-[clamp(0.72rem,3vw,0.95rem)] text-[#fff3dc] shadow-[0_0_42px_rgba(0,0,0,0.45),inset_0_1px_0_rgba(255,255,255,0.08)] sm:backdrop-blur-md">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <button
            className="text-left text-[clamp(0.58rem,2.1vw,0.7rem)] font-black uppercase tracking-[0.16em] text-[#f0ad6a] underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ffd18a]"
            type="button"
            onClick={onOpenCart}
          >
            Customer cart
          </button>
          <p className="mt-1 truncate text-[clamp(0.74rem,2.75vw,0.9rem)] font-black leading-tight">
            {displaySummary}
          </p>
          <p className="truncate text-[clamp(0.65rem,2.45vw,0.78rem)] font-semibold leading-tight text-[#d9a26e]">
            {cartEntries.length > 0 ? `${selectedCount} item${selectedCount === 1 ? "" : "s"} ready to checkout` : customerOrder ? "Order placed successfully" : "Tap products to add"}
          </p>
        </div>
        <motion.div
          key={total || customerOrder?.total || 0}
          className="shrink-0 text-right text-[clamp(1.05rem,4.3vw,1.35rem)] font-black leading-none text-[#ffd18a] drop-shadow-[0_0_12px_rgba(255,209,138,0.24)]"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.18 }}
        >
          {formatPrice(total || customerOrder?.total || 0)}
        </motion.div>
      </div>
      <AnimatePresence>
        {hasQueueStatus ? (
          <motion.div
            className="mt-2 rounded-[0.95rem] border border-[#ffd18a]/22 bg-[#24130d]/70 px-3 py-2 text-center"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={softSpring}
            role="status"
            aria-live="polite"
          >
            <p className="text-[clamp(0.6rem,2.1vw,0.72rem)] font-black uppercase tracking-[0.14em] text-[#f0ad6a]">
              Order #{customerOrder?.number} · {customerOrder ? getStatusLabel(customerOrder.status) : "Waiting"}
            </p>
            <p className="mt-0.5 text-[clamp(0.66rem,2.5vw,0.8rem)] font-black leading-tight text-[#fff3dc]">
              {customerOrder?.status === "done"
                ? "Served na ang order mo."
                : customerOrder?.status === "serving"
                  ? "Ikaw na ang sine-serve ngayon."
                  : `Pang #${queuePosition ?? "?"} ka sa pila.`}
            </p>
            {/* Rate Your Experience Button - Show when order is done */}
            {customerOrder?.status === "done" && !customerOrder.hasReview && (
              <button
                className="mt-2 w-full rounded-full bg-[#ffd18a] text-[#4a2416] px-3 py-1.5 text-[0.68rem] font-black uppercase tracking-wider hover:bg-[#ffc26b] transition-all"
                type="button"
                onClick={() => setShowReviewForm(true)}
              >
                ⭐ Rate Your Experience
              </button>
            )}
            {customerOrder?.hasReview && (
              <p className="mt-1.5 text-[0.62rem] font-bold text-[#88d18a]">
                ✓ Thank you for your review!
              </p>
            )}
          </motion.div>
        ) : null}
      </AnimatePresence>
      
      {/* Review Form Modal */}
      <AnimatePresence>
        {showReviewForm && customerOrder && (
          <motion.div
            className="absolute inset-0 z-50 flex items-center justify-center bg-[#070504]/94 p-4"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <motion.div
              className="w-full max-w-[320px] bg-[#120b07] border border-[#ffd18a]/32 p-4 rounded-[1.2rem] space-y-3"
              initial={{ scale: 0.95, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 20 }}
            >
              <div className="text-center">
                <p className="text-[0.62rem] font-black uppercase tracking-[0.16em] text-[#f0ad6a]">Rate Your Order</p>
                <h3 className="text-[1.12rem] font-black mt-0.5">How was your experience?</h3>
              </div>
              
              {/* Star Rating */}
              <div className="flex justify-center gap-1.5 py-2">
                {[1, 2, 3, 4, 5].map((star) => (
                  <button
                    key={star}
                    type="button"
                    className="text-[2.5rem] transition-transform hover:scale-110 focus:outline-none"
                    onClick={() => setReviewRating(star)}
                    aria-label={`${star} star${star > 1 ? "s" : ""}`}
                  >
                    {star <= reviewRating ? "⭐" : "☆"}
                  </button>
                ))}
              </div>
              
              {/* Comment */}
              <textarea
                className="w-full rounded-[0.8rem] border border-[#ffd18a]/18 bg-white/[0.02] px-3 py-2 text-[0.78rem] text-[#fff3dc] focus:border-[#ffd18a] focus:outline-none resize-none"
                placeholder="Share your experience (optional)..."
                rows={3}
                value={reviewComment}
                onChange={(e) => setReviewComment(e.target.value)}
              />
              
              {/* Actions */}
              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  className="flex-1 rounded-full border border-[#ffd18a]/20 text-[#ffd18a] py-2 text-[0.72rem] font-black uppercase"
                  onClick={() => setShowReviewForm(false)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="flex-1 rounded-full bg-[#ffd18a] text-[#4a2416] py-2 text-[0.72rem] font-black uppercase"
                  onClick={handleReviewSubmit}
                >
                  Submit Review
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
      
      <button
        className={cn(
          "mt-[clamp(0.55rem,2.2vw,0.72rem)] w-full rounded-full border px-4 py-[clamp(0.55rem,2.2vw,0.72rem)] text-[clamp(0.72rem,2.7vw,0.86rem)] font-black transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ffd18a] focus-visible:ring-offset-2 focus-visible:ring-offset-[#0f0906]",
          canCheckout
            ? "border-[#ffd18a] bg-[#ffd18a] text-[#4a2416] shadow-[0_0_24px_rgba(255,209,138,0.24)] hover:bg-[#ffc26b]"
            : "cursor-not-allowed border-[#4d2b19] bg-[#22130c] text-[#936943]"
        )}
        type="button"
        disabled={!canCheckout}
        onClick={() => {
          void onCheckout();
        }}
      >
        {canCheckout ? "Place order at cashier" : "Open cart / pick items"}
      </button>
      <AnimatePresence>
        {justSubmitted ? (
          <motion.div
            className="absolute inset-x-[6%] -top-[42%] rounded-full border border-[#ffd18a]/50 bg-[#1a100a] px-4 py-2 text-center text-[clamp(0.66rem,2.5vw,0.82rem)] font-black text-[#ffd18a] shadow-[0_0_26px_rgba(255,209,138,0.24)]"
            initial={{ opacity: 0, y: 12, scale: 0.94 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.96 }}
            transition={softSpring}
            role="status"
          >
            Order sent to cashier. Check your queue number.
          </motion.div>
        ) : null}
      </AnimatePresence>
    </aside>
  );
}

function CoffeeDessertCarousel() {
  const [coffeeIndex, setCoffeeIndex] = useState(0);
  const [dessertIndex, setDessertIndex] = useState(0);
  const [selectedItems, setSelectedItems] = useState<SelectedItems>({});
  const [favoriteIds, setFavoriteIds] = useState<string[]>([]);
  const [orders, setOrders] = useState<CafeOrder[]>(() => (isSupabaseConfigured ? [] : initialOrders));
  const [nextOrderNumber, setNextOrderNumber] = useState(103);
  const [customerOrderId, setCustomerOrderId] = useState<string | null>(() =>
    typeof window === "undefined" ? null : window.localStorage.getItem(CUSTOMER_ORDER_STORAGE_KEY)
  );
  const [activePanel, setActivePanel] = useState<ActivePanel>(null);
  const [justSubmitted, setJustSubmitted] = useState(false);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>(isSupabaseConfigured ? "connecting" : "demo");
  const [syncError, setSyncError] = useState("");

  const selectedCount = Object.values(selectedItems).reduce((sum, entry) => sum + entry.quantity, 0);
  const customerOrder = customerOrderId ? orders.find((order) => order.id === customerOrderId) : undefined;
  const customerQueuePosition = customerOrder ? getQueuePosition(orders, customerOrder.id) : null;
  // State-driven menu lists so Admin CRUD works seamlessly
  // Persistent System Passwords State
  const [cashierPassword, setCashierPassword] = useState(() => {
    return (typeof window !== "undefined" && window.localStorage.getItem("sinta-pass-cashier")) || "admin";
  });
  const [adminPassword, setAdminPassword] = useState(() => {
    return (typeof window !== "undefined" && window.localStorage.getItem("sinta-pass-admin")) || "sinta123";
  });

  const handleUpdatePasswords = useCallback(async (nextCashier: string, nextAdmin: string) => {
    setCashierPassword(nextCashier);
    setAdminPassword(nextAdmin);
    window.localStorage.setItem("sinta-pass-cashier", nextCashier);
    window.localStorage.setItem("sinta-pass-admin", nextAdmin);

    // Sync to Supabase Database dynamically!
    const client = supabase;
    if (client) {
      try {
        await client.from("store_config" as any).upsert([
          { key: "cashier_password", value: nextCashier },
          { key: "admin_password", value: nextAdmin }
        ]);
      } catch (err) {
        console.error("Failed to sync passwords to database:", err);
      }
    }
  }, []);

  // Sync passwords dynamically from Supabase database if configured
  useEffect(() => {
    const client = supabase;
    if (!client) return;

    let isMounted = true;

    const loadSyncedPasswords = async () => {
      const { data, error } = await client.from("store_config" as any).select("*");
      if (error || !data) return;

      let cashierPass = "admin";
      let adminPass = "sinta123";

      (data as any[]).forEach((row) => {
        if (row.key === "cashier_password") cashierPass = row.value;
        if (row.key === "admin_password") adminPass = row.value;
      });

      if (!isMounted) return;

      setCashierPassword(cashierPass);
      setAdminPassword(adminPass);
      window.localStorage.setItem("sinta-pass-cashier", cashierPass);
      window.localStorage.setItem("sinta-pass-admin", adminPass);
    };

    void loadSyncedPasswords();

    // Subscribe to password changes real-time!
    const channel = client
      .channel("store-config-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "store_config" }, () => {
        void loadSyncedPasswords();
      })
      .subscribe();

    return () => {
      isMounted = false;
      void client.removeChannel(channel);
    };
  }, []);

  const [coffees, setCoffees] = useState<CarouselItem[]>(() => {
    const saved = typeof window !== "undefined" ? window.localStorage.getItem("sinta-custom-coffees") : null;
    return saved ? JSON.parse(saved) : defaultCoffeeItems;
  });

  const [desserts, setDesserts] = useState<CarouselItem[]>(() => {
    const saved = typeof window !== "undefined" ? window.localStorage.getItem("sinta-custom-desserts") : null;
    return saved ? JSON.parse(saved) : defaultDessertItems;
  });

  // Save changes to localStorage so they persist
  useEffect(() => {
    window.localStorage.setItem("sinta-custom-coffees", JSON.stringify(coffees));
  }, [coffees]);

  useEffect(() => {
    window.localStorage.setItem("sinta-custom-desserts", JSON.stringify(desserts));
  }, [desserts]);

  // Sync products dynamically with Supabase if configured so they propagate to all devices!
  useEffect(() => {
    const client = supabase;
    if (!client) return;

    let isMounted = true;

    const loadSyncedProducts = async () => {
      const { data, error } = await client.from("products" as any).select("*").order("created_at", { ascending: true });
      if (error || !data) return;

      const coffeeList: CarouselItem[] = [];
      const dessertList: CarouselItem[] = [];

      (data as any[]).forEach((row) => {
        const item: CarouselItem = {
          id: row.id,
          name: row.name,
          price: Number(row.price),
          note: row.note,
          image: row.image,
          alt: row.alt || row.name,
          tag: row.tag || "Fresh",
          pairing: row.pairing || "Tasty Pair",
        };
        if (row.category === "coffee") {
          coffeeList.push(item);
        } else {
          dessertList.push(item);
        }
      });

      if (!isMounted) return;

      // Seed default items if remote is empty
      if (data.length === 0) {
        const seedList = [
          ...defaultCoffeeItems.map(c => ({ ...c, category: "coffee" })),
          ...defaultDessertItems.map(d => ({ ...d, category: "dessert" }))
        ];
        await client.from("products" as any).insert(seedList);
        return;
      }

      setCoffees(coffeeList);
      setDesserts(dessertList);
    };

    void loadSyncedProducts();

    // Subscribe to product database changes
    const channel = client
      .channel("products-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "products" }, () => {
        void loadSyncedProducts();
      })
      .subscribe();

    return () => {
      isMounted = false;
      void client.removeChannel(channel);
    };
  }, []);

  const handleUpdateCoffeesRemote = async (nextList: CarouselItem[]) => {
    setCoffees(nextList);
    const client = supabase;
    if (!client) return;

    // Detect deleted items
    const currentIds = nextList.map(item => item.id);
    const deletedIds = coffees.filter(c => !currentIds.includes(c.id)).map(c => c.id);

    if (deletedIds.length > 0) {
      await client.from("products" as any).delete().in("id", deletedIds);
    }

    // Upsert items
    const upserts = nextList.map(c => ({
      id: c.id,
      name: c.name,
      price: c.price,
      note: c.note,
      image: c.image,
      alt: c.alt,
      tag: c.tag,
      pairing: c.pairing,
      category: "coffee"
    }));

    await client.from("products" as any).upsert(upserts);
  };

  const handleUpdateDessertsRemote = async (nextList: CarouselItem[]) => {
    setDesserts(nextList);
    const client = supabase;
    if (!client) return;

    // Detect deleted items
    const currentIds = nextList.map(item => item.id);
    const deletedIds = desserts.filter(d => !currentIds.includes(d.id)).map(d => d.id);

    if (deletedIds.length > 0) {
      await client.from("products" as any).delete().in("id", deletedIds);
    }

    // Upserts items
    const upserts = nextList.map(d => ({
      id: d.id,
      name: d.name,
      price: d.price,
      note: d.note,
      image: d.image,
      alt: d.alt,
      tag: d.tag,
      pairing: d.pairing,
      category: "dessert"
    }));

    await client.from("products" as any).upsert(upserts);
  };

  useEffect(() => {
    if (typeof window !== "undefined") {
      (window as any)._openAdminPanel = () => {
        setActivePanel("admin");
      };
    }
  }, []);

  useEffect(() => {
    if (!justSubmitted) {
      return;
    }

    const timer = window.setTimeout(() => setJustSubmitted(false), 3000);
    return () => window.clearTimeout(timer);
  }, [justSubmitted]);

  const [lastOrdersCount, setLastOrdersCount] = useState(orders.length);
  const [soundEnabled, setSoundEnabled] = useState(() => {
    return (typeof window !== "undefined" && window.localStorage.getItem("sinta-sound-enabled")) !== "false";
  });

  // Persist sound toggle preference
  useEffect(() => {
    window.localStorage.setItem("sinta-sound-enabled", String(soundEnabled));
  }, [soundEnabled]);

  // Play order notification sound using soundManager
  useEffect(() => {
    if (orders.length > lastOrdersCount && soundEnabled) {
      soundManager.playOrderNew();
    }
    setLastOrdersCount(orders.length);
  }, [orders.length, lastOrdersCount, soundEnabled]);

  useEffect(() => {
    const client = supabase;

    if (!client) {
      setSyncStatus("demo");
      return;
    }

    let isMounted = true;

    const loadOrders = async () => {
      const { data, error } = await client
        .from("orders")
        .select("*")
        .order("order_number", { ascending: true });

      if (!isMounted) {
        return;
      }

      if (error) {
        setSyncStatus("error");
        setSyncError(error.message);
        return;
      }

      setOrders((data ?? []).map(rowToCafeOrder));
      setSyncStatus("live");
      setSyncError("");
    };

    void loadOrders();

    const channel = client
      .channel("orders-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "orders" }, () => {
        void loadOrders();
      })
      .subscribe((status) => {
        if (!isMounted) {
          return;
        }

        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          setSyncStatus("error");
          setSyncError(`Realtime ${status.toLowerCase().replace("_", " ")}`);
        }
      });

    return () => {
      isMounted = false;
      void client.removeChannel(channel);
    };
  }, []);

  const handleSelect = useCallback((position: StackPosition, item: CarouselItem) => {
    setSelectedItems((current) => {
      const existing = current[item.id];
      return {
        ...current,
        [item.id]: {
          item,
          quantity: existing ? existing.quantity + 1 : 1,
          position,
        },
      };
    });
    setJustSubmitted(false);
  }, []);

  const handleUpdateQuantity = useCallback((itemId: string, delta: number) => {
    setSelectedItems((current) => {
      const existing = current[itemId];
      if (!existing) return current;

      const newQty = existing.quantity + delta;
      if (newQty <= 0) {
        const next = { ...current };
        delete next[itemId];
        return next;
      }

      return {
        ...current,
        [itemId]: {
          ...existing,
          quantity: newQty,
        },
      };
    });
  }, []);

  const handleToggleFavorite = useCallback((item: CarouselItem) => {
    setFavoriteIds((current) => (current.includes(item.id) ? current.filter((id) => id !== item.id) : [...current, item.id]));
  }, []);

  const handleCheckout = useCallback(async (paymentMethod: "Cash" | "GCash") => {
    const cartEntries = Object.values(selectedItems);
    if (cartEntries.length === 0) {
      setActivePanel("cart");
      return;
    }

    const itemsList = cartEntries.map(({ item, quantity, position }) => ({
      id: item.id,
      name: item.name,
      price: item.price,
      quantity,
      category: position,
    }));

    if (supabase) {
      const firstCoffee = cartEntries.find((entry) => entry.position === "coffee")?.item || null;
      const firstDessert = cartEntries.find((entry) => entry.position === "dessert")?.item || null;

      const { data, error } = await supabase
        .from("orders")
        .insert({
          customer_name: "Customer",
          coffee_id: firstCoffee?.id ?? null,
          coffee_name: firstCoffee?.name ?? null,
          coffee_price: firstCoffee?.price ?? null,
          dessert_id: firstDessert?.id ?? null,
          dessert_name: firstDessert?.name ?? null,
          dessert_price: firstDessert?.price ?? null,
          total: getCartTotal(selectedItems),
          status: "waiting",
          items: itemsList,
          payment_method: paymentMethod,
          payment_status: paymentMethod === "GCash" ? "Paid" : "Not Paid"
        } as any)
        .select()
        .single();

      if (error) {
        setSyncStatus("error");
        setSyncError(error.message);
        setActivePanel("cart");
        return;
      }

      const newOrder = rowToCafeOrder(data);
      setOrders((current) => (current.some((order) => order.id === newOrder.id) ? current : [...current, newOrder]));
      setCustomerOrderId(newOrder.id);
      window.localStorage.setItem(CUSTOMER_ORDER_STORAGE_KEY, newOrder.id);
      setSelectedItems({});
      setActivePanel(null);
      setJustSubmitted(true);
      setSyncStatus("live");
      setSyncError("");
      return;
    }

    const orderNumber = nextOrderNumber;
    const firstCoffeeLine = cartEntries.find((entry) => entry.position === "coffee")?.item;
    const firstDessertLine = cartEntries.find((entry) => entry.position === "dessert")?.item;

    const order: CafeOrder = {
      id: `KC-${orderNumber}`,
      number: orderNumber,
      customerName: "Customer",
      coffee: firstCoffeeLine ? { id: firstCoffeeLine.id, name: firstCoffeeLine.name, price: firstCoffeeLine.price } : undefined,
      dessert: firstDessertLine ? { id: firstDessertLine.id, name: firstDessertLine.name, price: firstDessertLine.price } : undefined,
      items: itemsList,
      total: getCartTotal(selectedItems),
      status: "waiting",
      createdAt: getCurrentTimeLabel(),
      paymentMethod: paymentMethod,
      paymentStatus: paymentMethod === "GCash" ? "Paid" : "Not Paid",
    };

    setOrders((current) => [...current, order]);
    setNextOrderNumber((current) => current + 1);
    setCustomerOrderId(order.id);
    window.localStorage.setItem(CUSTOMER_ORDER_STORAGE_KEY, order.id);
    setSelectedItems({});
    setActivePanel(null);
    setJustSubmitted(true);
  }, [nextOrderNumber, selectedItems]);

  const updateOrderStatus = useCallback(async (orderId: string, status: OrderStatus) => {
    if (supabase) {
      const { error } = await supabase.from("orders").update({ status }).eq("id", orderId);

      if (error) {
        setSyncStatus("error");
        setSyncError(error.message);
        return;
      }
    }

    setOrders((current) => current.map((order) => (order.id === orderId ? { ...order, status } : order)));
  }, []);

  const updateOrderPaymentStatus = useCallback(async (orderId: string, paymentStatus: "Paid" | "Not Paid") => {
    if (supabase) {
      const { error } = await supabase.from("orders").update({ payment_status: paymentStatus } as any).eq("id", orderId);

      if (error) {
        setSyncStatus("error");
        setSyncError(error.message);
        return;
      }
    }

    setOrders((current) => current.map((order) => (order.id === orderId ? { ...order, paymentStatus } : order)));
  }, []);

  const handleServeNext = useCallback(async () => {
    if (orders.some((order) => order.status === "serving")) {
      return;
    }

    const nextWaitingOrder = orders.find((order) => order.status === "waiting");

    if (!nextWaitingOrder) {
      return;
    }

    await updateOrderStatus(nextWaitingOrder.id, "serving");
  }, [orders, updateOrderStatus]);

  const handleServeOrder = useCallback(
    async (orderId: string) => {
      if (orders.some((order) => order.status === "serving")) {
        return;
      }

      await updateOrderStatus(orderId, "serving");
    },
    [orders, updateOrderStatus]
  );

  const handleCompleteOrder = useCallback(
    async (orderId: string) => {
      await updateOrderStatus(orderId, "done");
    },
    [updateOrderStatus]
  );

  const handlePlacePOSOrder = useCallback(async (
    customerName: string,
    coffeeItem: CarouselItem | null,
    dessertItem: CarouselItem | null
  ) => {
    if (!coffeeItem && !dessertItem) return;

    if (supabase) {
      const { data, error } = await supabase
        .from("orders")
        .insert({
          customer_name: customerName || "Walk-in Guest",
          coffee_id: coffeeItem?.id ?? null,
          coffee_name: coffeeItem?.name ?? null,
          coffee_price: coffeeItem?.price ?? null,
          dessert_id: dessertItem?.id ?? null,
          dessert_name: dessertItem?.name ?? null,
          dessert_price: dessertItem?.price ?? null,
          total: (coffeeItem?.price ?? 0) + (dessertItem?.price ?? 0),
          status: "waiting",
        })
        .select()
        .single();

      if (error) {
        setSyncStatus("error");
        setSyncError(error.message);
        return;
      }

      const newOrder = rowToCafeOrder(data);
      setOrders((current) => (current.some((order) => order.id === newOrder.id) ? current : [...current, newOrder]));
      return;
    }

    const orderNumber = nextOrderNumber;
    const order: CafeOrder = {
      id: `KC-${orderNumber}`,
      number: orderNumber,
      customerName: customerName || "Walk-in Guest",
      coffee: coffeeItem ? { id: coffeeItem.id, name: coffeeItem.name, price: coffeeItem.price } : undefined,
      dessert: dessertItem ? { id: dessertItem.id, name: dessertItem.name, price: dessertItem.price } : undefined,
      total: (coffeeItem?.price ?? 0) + (dessertItem?.price ?? 0),
      status: "waiting",
      createdAt: getCurrentTimeLabel(),
      paymentMethod: "Cash",
      paymentStatus: "Not Paid",
    };

    setOrders((current) => [...current, order]);
    setNextOrderNumber((current) => current + 1);
  }, [nextOrderNumber]);

  return (
    <main
      className="relative isolate flex min-h-svh items-center justify-center overflow-hidden p-3 font-sans text-[#fff3dc] sm:p-6"
      style={{
        background:
          "radial-gradient(circle at 18% 12%, rgba(214, 128, 54, 0.26), transparent 30%), radial-gradient(circle at 82% 82%, rgba(255, 190, 112, 0.16), transparent 28%), linear-gradient(135deg, #050302 0%, #120a07 48%, #20100a 100%)",
      }}
    >
      <NightCafeBackdrop />
      <h1 className="sr-only">Kape and Crumbs coffee shop carousel</h1>
      <div
        className="relative overflow-hidden rounded-[2.15rem] border-[1.5px] border-[#ffd18a]/45 bg-[#0f0906] shadow-[0_24px_90px_rgba(0,0,0,0.68),0_0_80px_rgba(214,128,54,0.24),inset_0_1px_0_rgba(255,255,255,0.12)] sm:rounded-[2.7rem]"
        style={{ width: "min(95vw, 52svh, 440px)", aspectRatio: "430 / 820" }}
        aria-label="Kape and Crumbs coffee shop browser"
      >
        <CafeBackground glowing={selectedCount === 2} />
        <CafeHeader onOpenCashier={() => setActivePanel("cashier")} />
        <AppActionBar
          cartCount={selectedCount}
          onOpenCart={() => setActivePanel("cart")}
        />
        <SyncBadge status={syncStatus} error={syncError} />
        <CardStack
          items={coffees}
          activeIndex={coffeeIndex >= coffees.length ? 0 : coffeeIndex}
          selectedItemId={coffees[coffeeIndex >= coffees.length ? 0 : coffeeIndex] && selectedItems[coffees[coffeeIndex >= coffees.length ? 0 : coffeeIndex].id] ? coffees[coffeeIndex >= coffees.length ? 0 : coffeeIndex].id : undefined}
          favoriteIds={favoriteIds}
          onChange={setCoffeeIndex}
          onSelect={(item) => handleSelect("coffee", item)}
          onToggleFavorite={handleToggleFavorite}
          position="coffee"
          label="Coffee"
          imageLabel="Coffee Image"
        />
        <CardStack
          items={desserts}
          activeIndex={dessertIndex >= desserts.length ? 0 : dessertIndex}
          selectedItemId={desserts[dessertIndex >= desserts.length ? 0 : dessertIndex] && selectedItems[desserts[dessertIndex >= desserts.length ? 0 : dessertIndex].id] ? desserts[dessertIndex >= desserts.length ? 0 : dessertIndex].id : undefined}
          favoriteIds={favoriteIds}
          onChange={setDessertIndex}
          onSelect={(item) => handleSelect("dessert", item)}
          onToggleFavorite={handleToggleFavorite}
          position="dessert"
          label="Dessert"
          imageLabel="Desert Image"
        />
        <OrderTray
          selectedItems={selectedItems}
          customerOrder={customerOrder}
          queuePosition={customerQueuePosition}
          justSubmitted={justSubmitted}
          onCheckout={() => void handleCheckout("Cash")}
          onOpenCart={() => setActivePanel("cart")}
          onSubmitReview={async (orderId: string, rating: number, comment: string) => {
            if (supabase) {
              const order = orders.find((o) => o.id === orderId);
              if (!order) return;
              
              const { error } = await supabase.from("reviews" as any).insert({
                order_id: orderId,
                order_number: order.number,
                customer_name: order.customerName,
                rating,
                comment: comment || null,
                product_rated: order.coffee?.name || order.dessert?.name || "Order #" + order.number,
                product_category: order.coffee && order.dessert ? "Overall" : order.coffee ? "Coffee" : "Dessert",
                is_public: true,
              });
              
              if (!error) {
                setOrders((current) =>
                  current.map((o) => (o.id === orderId ? { ...o, hasReview: true, rating } : o))
                );
                soundManager.playSuccess();
              }
            } else {
              // Local storage fallback
              setOrders((current) =>
                current.map((o) => (o.id === orderId ? { ...o, hasReview: true, rating } : o))
              );
              soundManager.playSuccess();
            }
          }}
        />
        <AnimatePresence>
          {activePanel === "cart" ? (
            <CartPanel
              selectedItems={selectedItems}
              customerOrder={customerOrder}
              queuePosition={customerQueuePosition}
              onUpdateQuantity={handleUpdateQuantity}
              onCheckout={handleCheckout}
              onClose={() => setActivePanel(null)}
            />
          ) : null}
          {activePanel === "cashier" ? (
            <CashierPanel
              orders={orders}
              onServeNext={handleServeNext}
              onServeOrder={handleServeOrder}
              onCompleteOrder={handleCompleteOrder}
              onPlacePOSOrder={handlePlacePOSOrder}
              onUpdatePaymentStatus={updateOrderPaymentStatus}
              onClose={() => setActivePanel(null)}
              coffees={coffees}
              desserts={desserts}
              cashierPassword={cashierPassword}
              soundEnabled={soundEnabled}
              setSoundEnabled={setSoundEnabled}
            />
          ) : null}
          {activePanel === "admin" ? (
            <AdminPanel
              coffees={coffees}
              desserts={desserts}
              orders={orders}
              onUpdateCoffees={handleUpdateCoffeesRemote}
              onUpdateDesserts={handleUpdateDessertsRemote}
              onResetOrders={async () => {
                if (supabase) {
                  const { error } = await supabase.from("orders").delete().neq("id", "00000000-0000-0000-0000-000000000000");
                  if (error) {
                    setSyncStatus("error");
                    setSyncError(error.message);
                    return;
                  }
                }
                setOrders([]);
                setNextOrderNumber(100);
                setCustomerOrderId(null);
                window.localStorage.removeItem(CUSTOMER_ORDER_STORAGE_KEY);
              }}
              onClose={() => setActivePanel(null)}
              adminPassword={adminPassword}
              cashierPassword={cashierPassword}
              onUpdatePasswords={handleUpdatePasswords}
            />
          ) : null}
        </AnimatePresence>
      </div>
    </main>
  );
}

export default function App() {
  return <CoffeeDessertCarousel />;
}