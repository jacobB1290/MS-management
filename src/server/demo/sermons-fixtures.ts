import "server-only"

/**
 * Demo sermons for the /sermons monitor surface. Kept OUT of the generated
 * fixtures.ts (which `sim:verify` byte-matches against its generator) and merged
 * into the demo client's table map separately — same pattern as events-fixtures.
 * Hand-authored to cover every monitor state: in-review (with full chapters),
 * published, failed-at-transcribe, and a live in-progress run.
 */

type Row = Record<string, unknown>

const MIN = 60_000
const now = Date.now()
const ago = (min: number) => new Date(now - min * MIN).toISOString()

const sermonChaptersGoodShepherd: Row[] = [
  {"startSec":0,"endSec":215,"type":"welcome","title":"Welcome and call to worship","summary":"A warm greeting, a few announcements, and an invitation to quiet our hearts before God.","scriptureRefs":[]},
  {"startSec":215,"endSec":612,"type":"worship","title":"Opening worship","summary":"The congregation sings together, centering the morning on gratitude and praise.","scriptureRefs":[]},
  {"startSec":612,"endSec":760,"type":"scripture","title":"Reading: Psalm 23","summary":"Psalm 23 is read aloud as the anchor passage for the morning.","scriptureRefs":["Psalm 23:1-6"]},
  {"startSec":760,"endSec":905,"type":"prayer","title":"Pastoral prayer","summary":"A prayer for the sick, the city, and hearts that feel far from the shepherd.","scriptureRefs":[]},
  {"startSec":905,"endSec":2680,"type":"sermon","title":"Sermon: The Good Shepherd","summary":"The shepherd knows his sheep by name, goes after the one who wanders, and lays down his life. We are not managed, we are known and pursued.","scriptureRefs":["John 10:11-18","Luke 15:3-7"]},
  {"startSec":2680,"endSec":2890,"type":"benediction","title":"Closing and sending","summary":"A final blessing and a charge to carry the shepherd's care into the week.","scriptureRefs":[]},
]
const sermonChaptersMending: Row[] = [
  {"startSec":0,"endSec":240,"type":"welcome","title":"Welcome","summary":"Greetings and a brief look at the week ahead at Morning Star.","scriptureRefs":[]},
  {"startSec":240,"endSec":680,"type":"worship","title":"Worship set","summary":"Three songs of lament turning to hope.","scriptureRefs":[]},
  {"startSec":680,"endSec":840,"type":"scripture","title":"Reading: Isaiah 61","summary":"The promise to bind up the brokenhearted is read.","scriptureRefs":["Isaiah 61:1-3"]},
  {"startSec":840,"endSec":2510,"type":"sermon","title":"Sermon: Mending the Broken","summary":"God does not discard what is broken; he mends it, and often the seam becomes the strongest part. A call to bring our broken places into the light.","scriptureRefs":["Isaiah 61:1-3","2 Corinthians 4:7-9"]},
  {"startSec":2510,"endSec":2700,"type":"prayer","title":"Response and prayer","summary":"An invitation to respond, with prayer teams available.","scriptureRefs":[]},
]
export const demoSermons: Row[] = [
  // Newest: in review with full chapters — the feature card + the workflow star.
  {"id":"SR01","youtube_video_id":"8EP7I-lXdFI","slug":"the-good-shepherd-2026-06-14","title":"LIVE - Sunday Morning 9:00am |  6/14/2026  |  Morning Star Church of Boise","generated_title":"The Shepherd Who Knows You by Name","status":"review","published_at":null,"thumbnail_url":"https://img.youtube.com/vi/8EP7I-lXdFI/maxresdefault.jpg","duration_sec":2890,"summary":"This week we sat in Psalm 23 and John 10: the shepherd who knows each of us by name, goes after the one who wanders, and lays down his life for the sheep. A reminder that we are not managed by God, we are known and pursued by him.","transcript":"Good morning, church. It is so good to be together. Let's quiet our hearts this morning...\n\nThe Lord is my shepherd, I shall not want. He makes me lie down in green pastures...\n\nJesus says, I am the good shepherd. The good shepherd lays down his life for the sheep. Now a hired hand, when he sees the wolf coming, he runs. But the shepherd stays...\n\nAnd here is the wonder of it: he knows his own and his own know him. You are not a number to God this morning. He knows your name, he knows your wandering, and he has come after you.","segments":sermonChaptersGoodShepherd,"seo":{"description":"The Good Shepherd: a sermon from Morning Star Christian Church in Boise on Psalm 23 and John 10 — the God who knows us by name and pursues the one who wanders.","tags":["good shepherd","psalm 23","john 10","being known","pursuit","hope"]},"source":"youtube","error":null,"created_by":null,"created_at":ago(1500),"updated_at":ago(1490)},
  // Published a week ago — what "live on the site" looks like.
  {"id":"SR02","youtube_video_id":"dff8EP7I-lX","slug":"mending-the-broken-2026-06-07","title":"Mending the Broken","status":"published","published_at":ago(8600),"thumbnail_url":"https://img.youtube.com/vi/dff8EP7I-lX/maxresdefault.jpg","duration_sec":2700,"summary":"From Isaiah 61: God does not discard what is broken, he mends it — and often the mended seam becomes the strongest part. An invitation to bring our broken places into the light.","transcript":"We are glad you are here this morning. Whatever you walked in carrying...\n\nThe Spirit of the Lord God is upon me, because the Lord has anointed me to bring good news to the poor; he has sent me to bind up the brokenhearted...\n\nThere is a Japanese art called kintsugi, where broken pottery is repaired with gold...","segments":sermonChaptersMending,"seo":{"description":"Mending the Broken: a sermon from Morning Star Christian Church, Boise, on Isaiah 61 — the God who binds up the brokenhearted and makes the mended seam the strongest part.","tags":["brokenness","isaiah 61","healing","hope","kintsugi","restoration"]},"source":"youtube","error":null,"created_by":null,"created_at":ago(8700),"updated_at":ago(8590)},
  // Failed at transcribe — shows the monitor's failure surface honestly.
  {"id":"SR03","youtube_video_id":"aBcD3fGh1Jk","slug":null,"title":"Sunday Service","status":"failed","published_at":null,"thumbnail_url":"https://img.youtube.com/vi/aBcD3fGh1Jk/maxresdefault.jpg","duration_sec":null,"summary":null,"transcript":null,"segments":[],"seo":null,"source":"youtube","error":"transcribe_no_captions","created_by":null,"created_at":ago(15800),"updated_at":ago(15790)},
  // Older published — fills the poster grid.
  {"id":"SR04","youtube_video_id":"Lm4N0pQrS7t","slug":"carried-by-grace-2026-05-24","title":"Carried by Grace","status":"published","published_at":ago(38800),"thumbnail_url":"https://img.youtube.com/vi/Lm4N0pQrS7t/maxresdefault.jpg","duration_sec":2540,"summary":"A look at Ephesians 2: saved by grace through faith, not by anything we carry in on our own. Rest for the tired and the trying.","transcript":"Grace. We say the word so often we can forget how scandalous it is...","segments":sermonChaptersMending,"seo":{"description":"Carried by Grace: a sermon from Morning Star Christian Church, Boise, on Ephesians 2 — saved by grace through faith, rest for the tired and the trying.","tags":["grace","ephesians 2","faith","rest","salvation"]},"source":"youtube","error":null,"created_by":null,"created_at":ago(39000),"updated_at":ago(38790)},
]
export const demoSermonRuns: Row[] = [
  // A live run in progress — the pulsing dot in the monitor.
  {"id":"RUN01","sermon_id":"SR01","youtube_video_id":"8EP7I-lXdFI","status":"running","trigger":"manual","started_at":ago(1),"finished_at":null,"steps":[{"name":"detect","status":"succeeded","startedAt":ago(1.1),"finishedAt":ago(1.05),"detail":"re-running review"},{"name":"transcribe","status":"running","startedAt":ago(1.0),"finishedAt":null}],"created_by":"demo-admin","created_at":ago(1),"updated_at":ago(1)},
  // The cron run that produced SR01.
  {"id":"RUN02","sermon_id":"SR01","youtube_video_id":"8EP7I-lXdFI","status":"succeeded","trigger":"cron","started_at":ago(1495),"finished_at":ago(1494),"steps":[{"name":"detect","status":"succeeded","startedAt":ago(1495),"finishedAt":ago(1495),"detail":"new video"},{"name":"transcribe","status":"succeeded","startedAt":ago(1495),"finishedAt":ago(1494.6),"detail":"612 cues, ~48 min, auto-captions"},{"name":"segment","status":"succeeded","startedAt":ago(1494.6),"finishedAt":ago(1494),"detail":"6 chapters"}],"created_by":null,"created_at":ago(1495),"updated_at":ago(1494)},
  // The failed cron run for SR03 — caption access not available.
  {"id":"RUN03","sermon_id":"SR03","youtube_video_id":"aBcD3fGh1Jk","status":"failed","trigger":"cron","started_at":ago(15795),"finished_at":ago(15794),"steps":[{"name":"detect","status":"succeeded","startedAt":ago(15795),"finishedAt":ago(15795),"detail":"new video"},{"name":"transcribe","status":"failed","startedAt":ago(15795),"finishedAt":ago(15794),"error":"no_captions: captions not available for this video yet"}],"created_by":null,"created_at":ago(15795),"updated_at":ago(15794)},
  // A clean no-op cron tick — already processed.
  {"id":"RUN04","sermon_id":"SR02","youtube_video_id":"dff8EP7I-lX","status":"succeeded","trigger":"cron","started_at":ago(7000),"finished_at":ago(7000),"steps":[{"name":"detect","status":"skipped","startedAt":ago(7000),"finishedAt":ago(7000),"detail":"already published"}],"created_by":null,"created_at":ago(7000),"updated_at":ago(7000)},
  // The manual run that produced SR02.
  {"id":"RUN05","sermon_id":"SR02","youtube_video_id":"dff8EP7I-lX","status":"succeeded","trigger":"manual","started_at":ago(8650),"finished_at":ago(8649),"steps":[{"name":"detect","status":"succeeded","startedAt":ago(8650),"finishedAt":ago(8650),"detail":"new video"},{"name":"transcribe","status":"succeeded","startedAt":ago(8650),"finishedAt":ago(8649.5),"detail":"540 cues, ~45 min, auto-captions"},{"name":"segment","status":"succeeded","startedAt":ago(8649.5),"finishedAt":ago(8649),"detail":"5 chapters"}],"created_by":"demo-admin","created_at":ago(8650),"updated_at":ago(8649)},
]
