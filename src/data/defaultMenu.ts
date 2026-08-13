export type CarouselItem = {
  id: string;
  name: string;
  image: string;
  alt: string;
  note: string;
  price: number;
  tag: string;
  pairing: string;
};

export const defaultCoffeeItems: CarouselItem[] = [
  {
    id: "espresso",
    name: "Espresso",
    image:
      "https://images.pexels.com/photos/21367366/pexels-photo-21367366.jpeg?auto=compress&cs=tinysrgb&fit=crop&h=1200&w=800",
    alt: "Warm espresso cup on a saucer in a dim cafe",
    note: "Short, rich, and bold with a caramel crema.",
    price: 95,
    tag: "Bold shot",
    pairing: "Best with Walnut Brownie",
  },
  {
    id: "latte",
    name: "Latte",
    image:
      "https://images.pexels.com/photos/32176011/pexels-photo-32176011.jpeg?auto=compress&cs=tinysrgb&fit=crop&h=1200&w=800",
    alt: "Latte with detailed foam art in a cafe cup",
    note: "Silky steamed milk with a mellow espresso finish.",
    price: 145,
    tag: "Creamy favorite",
    pairing: "Best with Tiramisu",
  },
  {
    id: "cappuccino",
    name: "Cappuccino",
    image:
      "https://images.pexels.com/photos/38657936/pexels-photo-38657936.jpeg?auto=compress&cs=tinysrgb&fit=crop&h=1200&w=800",
    alt: "Creamy cappuccino served in a rustic coffee cup",
    note: "Foamy, balanced, and dusted for a classic cafe sip.",
    price: 135,
    tag: "Foam cloud",
    pairing: "Best with Chocolate Cake",
  },
  {
    id: "iced-americano",
    name: "Iced Americano",
    image:
      "https://images.pexels.com/photos/18457338/pexels-photo-18457338.jpeg?auto=compress&cs=tinysrgb&fit=crop&h=1200&w=800",
    alt: "Iced americano in a glass with visible ice cubes",
    note: "Bright espresso over ice for a clean refreshing pour.",
    price: 125,
    tag: "Cool brew",
    pairing: "Best with Glazed Donut",
  },
];

export const defaultDessertItems: CarouselItem[] = [
  {
    id: "chocolate-cake",
    name: "Chocolate Cake",
    image:
      "https://images.pexels.com/photos/28402363/pexels-photo-28402363.jpeg?auto=compress&cs=tinysrgb&fit=crop&h=1200&w=800",
    alt: "Rich chocolate cake slice with icing on a white plate",
    note: "Deep cocoa layers with a glossy chocolate drizzle.",
    price: 185,
    tag: "Decadent slice",
    pairing: "Lovely with Cappuccino",
  },
  {
    id: "tiramisu",
    name: "Tiramisu",
    image:
      "https://images.pexels.com/photos/27305271/pexels-photo-27305271.jpeg?auto=compress&cs=tinysrgb&fit=crop&h=1200&w=800",
    alt: "Piece of tiramisu on a plate on a rustic table",
    note: "Coffee soaked layers with mascarpone and cocoa.",
    price: 195,
    tag: "Cafe classic",
    pairing: "Lovely with Latte",
  },
  {
    id: "glazed-donut",
    name: "Glazed Donut",
    image:
      "https://images.pexels.com/photos/10117389/pexels-photo-10117389.jpeg?auto=compress&cs=tinysrgb&fit=crop&h=1200&w=800",
    alt: "Pink sprinkled donut with chocolate glazed pastries",
    note: "Soft bakery donut with a bright sweet glaze.",
    price: 85,
    tag: "Sweet pop",
    pairing: "Lovely with Iced Americano",
  },
  {
    id: "walnut-brownie",
    name: "Walnut Brownie",
    image:
      "https://images.pexels.com/photos/4311548/pexels-photo-4311548.jpeg?auto=compress&cs=tinysrgb&fit=crop&h=1200&w=800",
    alt: "Chocolate brownies topped with walnuts on a plate",
    note: "Fudgy chocolate center with toasted walnut crunch.",
    price: 155,
    tag: "Fudgy bite",
    pairing: "Lovely with Espresso",
  },
];
