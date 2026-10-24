// ============================================================
//  BANSHEE JUKEBOX CONFIG
//  Nothing secret lives here: this file is public.
//  Keys, PINs and prices are held by the worker.
// ============================================================
window.BANSHEE = {
  venueName: "THE BANSHEE LABYRINTH",
  // Set this to your deployed worker URL after `wrangler deploy`
  workerUrl: "",
  // Display only. The worker holds the real prices, keep these in sync with TIERS.
  tiers: [
    { id: "tier1", price: "£1", plays: 2 },
    { id: "tier2", price: "£2", plays: 5, best: true },
  ],
};
