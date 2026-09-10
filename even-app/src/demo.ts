export const DEMO_ANSWER = `Street menu, lunch board.

Today's specials
Tomato basil soup 6
Roasted chicken with lemon potatoes 14
Mushroom risotto 13
House salad, optional anchovies 9

Drinks
Espresso 3
Cappuccino 4
House red or white wine, glass 7
Sparkling water 3

The board is handwritten. Soup is the cheapest hot dish. Risotto is vegetarian. If you want the fastest order, soup plus espresso is about nine.

Hours printed at the bottom: open 11:30 to 15:00 weekdays. Closed Sunday. A small note says kitchen last call 14:30.

Allergen line: risotto contains dairy; salad dressing is mustard vinaigrette. Bread basket has sesame.

If you are deciding in a few seconds: chicken is the filling pick, risotto if you want vegetarian, soup if you only have a short stop.

Card on the counter: contactless yes, cash yes, no American Express. Tip jar is optional. The daily pastry is lemon olive-oil cake, 4.

Queue: two people ahead. The specials board is the source of truth, not the printed paper menu on the table, which is last week's list.`;

export function demoJob(id = 'demo-local-1') {
  return {
    jobId: id,
    status: 'complete' as const,
    seq: 1,
    mode: 'general',
    answer: DEMO_ANSWER,
    createdAt: new Date().toISOString(),
  };
}

