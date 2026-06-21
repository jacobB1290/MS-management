import "server-only"

/**
 * Demo events for the /events surface. Kept OUT of the generated fixtures.ts
 * (which `sim:verify` byte-matches against its generator) and merged into the
 * demo client's table map separately. Dates are fixed (not relative) so the
 * harness screenshots are deterministic, and the flyer is an inline SVG data
 * URL so the cards/detail render a real image with zero network — hermetic.
 */

type Row = Record<string, unknown>

// A gold-gradient SVG "flyer" as a data URL — looks like a real portrait flyer
// in the card + detail previews without hotlinking anything.
const FLYER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="800" viewBox="0 0 600 800">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#b08c64"/><stop offset="1" stop-color="#6e5239"/>
  </linearGradient></defs>
  <rect width="600" height="800" fill="url(#g)"/>
  <text x="300" y="150" fill="#fff8ee" font-family="Georgia, serif" font-size="34" letter-spacing="6" text-anchor="middle">MAY 15</text>
  <text x="300" y="400" fill="#fff8ee" font-family="Georgia, serif" font-size="62" text-anchor="middle">Easter</text>
  <text x="300" y="470" fill="#fff8ee" font-family="Georgia, serif" font-size="62" text-anchor="middle">in the Park</text>
  <text x="300" y="650" fill="#fbe6cf" font-family="Inter, sans-serif" font-size="26" letter-spacing="2" text-anchor="middle">11 AM &#8211; 2 PM</text>
</svg>`
const FLYER = `data:image/svg+xml,${encodeURIComponent(FLYER_SVG)}`

export const demoEvents: Row[] = [
  {
    id: "E01",
    gcal_event_id: "demo_gcal_E01",
    gcal_calendar_id: null,
    title: "Easter in the Park",
    description:
      "Join us for a free community Easter celebration with games, food, and an egg hunt for all ages.\n\nWhat to bring:\n- A blanket or lawn chairs\n- Your neighbors and friends\n- An appetite for the potluck",
    starts_at: "2027-05-15T17:00:00.000Z",
    ends_at: "2027-05-15T20:00:00.000Z",
    all_day: false,
    location: "Ann Morrison Park, Boise",
    cta_text: "Reserve your spot",
    cta_url: "https://ms.church/form",
    secondary_cta_text: "Get directions",
    secondary_cta_url: "https://www.google.com/maps/search/?api=1&query=Ann+Morrison+Park+Boise",
    cost: "Free",
    ages: "All ages",
    rsvp_by: "May 1",
    image_drive_file_id: null,
    image_public_url: FLYER,
    image_storage_path: "demo/easter-in-the-park.svg",
    status: "published",
    source: "crm",
    synced_at: "2027-04-20T17:00:00.000Z",
    created_by: "demo-admin",
    created_at: "2027-04-18T17:00:00.000Z",
    updated_at: "2027-04-20T17:00:00.000Z",
  },
  {
    id: "E02",
    gcal_event_id: "demo_gcal_E02",
    gcal_calendar_id: null,
    title: "Youth Game Night",
    description: "An evening of games, pizza, and hanging out for students in grades 6 to 12.",
    starts_at: "2027-05-28T19:00:00.000Z",
    ends_at: null,
    all_day: false,
    location: "Morning Star — Youth Room",
    cta_text: null,
    cta_url: null,
    secondary_cta_text: null,
    secondary_cta_url: null,
    cost: null,
    ages: "Grades 6–12",
    rsvp_by: null,
    image_drive_file_id: null,
    image_public_url: null,
    image_storage_path: null,
    status: "draft",
    source: "crm",
    synced_at: null,
    created_by: "demo-admin",
    created_at: "2027-04-22T17:00:00.000Z",
    updated_at: "2027-04-22T17:00:00.000Z",
  },
  {
    id: "E03",
    gcal_event_id: "demo_gcal_E03",
    gcal_calendar_id: null,
    title: "Friendsgiving 2024",
    description: "A wonderful potluck where the whole community shared a table.",
    starts_at: "2024-11-23T12:00:00.000Z",
    ends_at: null,
    all_day: true,
    location: "Morning Star Christian Church",
    cta_text: null,
    cta_url: null,
    secondary_cta_text: null,
    secondary_cta_url: null,
    cost: null,
    ages: null,
    rsvp_by: null,
    image_drive_file_id: null,
    image_public_url: null,
    image_storage_path: null,
    status: "published",
    source: "gcal",
    synced_at: "2024-11-20T12:00:00.000Z",
    created_by: "demo-admin",
    created_at: "2024-11-10T12:00:00.000Z",
    updated_at: "2024-11-20T12:00:00.000Z",
  },
]
