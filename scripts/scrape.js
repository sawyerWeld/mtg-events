#!/usr/bin/env node

/**
 * MTG Events Scraper
 * Fetches events from local game stores in the Triangle area (NC)
 * and outputs structured JSON for the static frontend.
 */

import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'data');

// ── Store definitions ──────────────────────────────────────────────
const STORES = [
  {
    id: 'atomic-empire',
    name: 'Atomic Empire',
    city: 'Durham',
    url: 'https://www.atomicempire.com/Store/Events',
    eventsUrl: 'https://www.atomicempire.com/Store/Events',
    jinaUrl: 'https://r.jina.ai/https://www.atomicempire.com/Store/Events',
  },
  {
    id: 'gathering-place',
    name: 'The Gathering Place',
    city: 'Durham',
    url: 'https://gatheringplacegames.com/events/',
    eventsUrl: 'https://gatheringplacegames.com/events/',
    jinaUrl: 'https://r.jina.ai/https://gatheringplacegames.com/events/',
  },
  {
    id: 'game-theory',
    name: 'Game Theory',
    city: 'Raleigh',
    url: 'https://shop.gametheorystore.com/pages/events',
    eventsUrl: 'https://shop.gametheorystore.com/pages/events',
    jinaUrl: 'https://r.jina.ai/https://shop.gametheorystore.com/pages/events',
  },
  {
    id: 'shuffle-n-roll',
    name: 'Shuffle N Roll',
    city: 'Mebane',
    url: 'https://shufflenroll.com/',
    eventsUrl: 'https://shufflenroll.com/',
    jinaUrl: 'https://r.jina.ai/https://shufflenroll.com/',
  },
  {
    id: 'picante-tcg',
    name: 'Picante TCG',
    city: 'Greensboro',
    url: 'https://picantetcg.com/',
    eventsUrl: 'https://picantetcg.com/',
    jinaUrl: 'https://r.jina.ai/https://picantetcg.com/',
  },
  {
    id: 'dragons-hoard',
    name: "Dragon's Hoard",
    city: 'Greensboro',
    url: 'https://www.dragonshoardnc.com/',
    eventsUrl: 'https://www.dragonshoardnc.com/',
    jinaUrl: 'https://r.jina.ai/https://www.dragonshoardnc.com/',
  },
];

// ── MTG keywords & format detection ────────────────────────────────
const MTG_KEYWORDS = [
  'magic', 'mtg', 'commander', 'edh', 'cedh', 'draft', 'fnm',
  'modern', 'standard', 'pioneer', 'pauper', 'sealed', 'prerelease',
  'friday night magic', 'magic academy', 'deckbuild', 'strixhaven',
  'ninja turtles', 'tmnt', 'little walkers', 'turtle time',
];

function detectFormat(title) {
  const t = title.toLowerCase();
  if (t.includes('draft')) return 'Draft';
  if (t.includes('commander') || t.includes('edh') || t.includes('cedh')) return 'Commander/EDH';
  if (t.includes('standard') && !t.includes('standard format')) return 'Standard';
  if (t.includes('modern')) return 'Modern';
  if (t.includes('pioneer')) return 'Pioneer';
  if (t.includes('pauper')) return 'Pauper';
  if (t.includes('sealed') || t.includes('prerelease')) return 'Prerelease/Sealed';
  if (t.includes('fnm')) return 'FNM';
  if (t.includes('legacy')) return 'Legacy';
  return 'Other';
}

const NOT_MTG_KEYWORDS = [
  'pokemon', 'pokémon', 'lorcana', 'one piece', 'dragon ball', 'digimon',
  'star wars', 'swu', 'riftbound', 'gundam', 'flesh and blood', 'fab ',
  'yugioh', 'yu-gi-oh', 'warhammer', 'heroclix',
];

function isMtgEvent(title) {
  const t = title.toLowerCase();
  if (NOT_MTG_KEYWORDS.some(kw => t.includes(kw))) return false;
  return MTG_KEYWORDS.some(kw => t.includes(kw));
}

// ── Fetch helper ───────────────────────────────────────────────────
async function fetchText(url, timeoutMs = 30000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'Accept': 'text/plain, text/html, */*' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

// ── Year helper ────────────────────────────────────────────────────
const CURRENT_YEAR = new Date().getFullYear();

const MONTHS = {
  january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
  july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
};

function parseMonthDay(monthStr, dayStr) {
  const m = MONTHS[monthStr.toLowerCase()];
  if (m === undefined) return null;
  const d = parseInt(dayStr, 10);
  if (isNaN(d)) return null;
  return { month: m, day: d };
}

// ── Atomic Empire time lookup ──────────────────────────────────────
// Times from og:description of individual event pages. These are stable recurring times.
function guessAtomicTime(title) {
  const t = title.toLowerCase();
  if (t.includes('fnm') && t.includes('draft')) return '6:30 PM';
  if (t.includes('fnm') && t.includes('pauper')) return '6:30 PM';
  if (t.includes('commander mixer')) return '7:15 PM';
  if (t.includes('rcq') || (t.includes('regional') && t.includes('qualifier'))) return '11:00 AM';
  if (t.includes('fnm')) return '6:30 PM';
  return '';
}

// ── Scraper: Atomic Empire ─────────────────────────────────────────
async function scrapeAtomicEmpire(store) {
  const text = await fetchText(store.jinaUrl);
  const events = [];
  
  // Pattern: "* Day, Month Nth\n* [Event Title](url)"
  const datePattern = /(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),\s+(\w+)\s+(\d+)(?:st|nd|rd|th)/gi;
  const lines = text.split('\n');
  
  let currentDate = null;
  
  for (const line of lines) {
    const dateMatch = line.match(/(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),\s+(\w+)\s+(\d+)(?:st|nd|rd|th)/i);
    if (dateMatch) {
      const parsed = parseMonthDay(dateMatch[1], dateMatch[2]);
      if (parsed) {
        // Handle year rollover
        let year = CURRENT_YEAR;
        const now = new Date();
        const testDate = new Date(year, parsed.month, parsed.day);
        if (testDate < new Date(now.getFullYear(), now.getMonth() - 1, 1)) {
          year = CURRENT_YEAR + 1;
        }
        currentDate = `${year}-${String(parsed.month + 1).padStart(2, '0')}-${String(parsed.day).padStart(2, '0')}`;
      }
      continue;
    }
    
    // Event link pattern: [Event Title](url)
    const eventMatch = line.match(/\[([^\]]+)\]\((https:\/\/www\.atomicempire\.com\/Store\/Event\/\d+)\)/);
    if (eventMatch && currentDate) {
      const title = eventMatch[1].trim();
      const url = eventMatch[2];
      
      if (isMtgEvent(title)) {
        events.push({
          store: store.id,
          storeName: store.name,
          city: store.city,
          date: currentDate,
          time: guessAtomicTime(title),
          title,
          description: '',
          url,
          format: detectFormat(title),
        });
      }
    }
  }
  
  return events;
}

// ── Scraper: The Gathering Place ───────────────────────────────────
async function scrapeGatheringPlace(store) {
  const text = await fetchText(store.jinaUrl);
  const events = [];
  
  // This store has recurring weekly events. Parse them from the calendar section.
  // Calendar entries look like: "7:00 PM - [Thursday Night Commander/EDH Meetup](url)"
  // Date headers in the calendar look like days of month
  
  // Also parse from the main listing which has dated entries
  // Pattern: "### [Event Title](url)\n\n Month Day, Year\n\n Time"
  
  const blocks = text.split(/###\s+\[/);
  
  for (const block of blocks) {
    const titleMatch = block.match(/^([^\]]+)\]\(([^)]+)\)/);
    if (!titleMatch) continue;
    
    const title = titleMatch[1].trim();
    const url = titleMatch[2].trim();
    
    if (!isMtgEvent(title)) continue;
    
    // Extract date: "January 1, 2026" or similar
    const dateMatch = block.match(/(\w+)\s+(\d{1,2}),\s+(\d{4})/);
    let date = '';
    if (dateMatch) {
      const parsed = parseMonthDay(dateMatch[1], dateMatch[2]);
      if (parsed) {
        date = `${dateMatch[3]}-${String(parsed.month + 1).padStart(2, '0')}-${String(parsed.day).padStart(2, '0')}`;
      }
    }
    
    // Extract time
    const timeMatch = block.match(/(\d{1,2}:\d{2}\s*[ap]m)\s*-\s*(\d{1,2}:\d{2}\s*[ap]m)/i);
    const time = timeMatch ? timeMatch[1] : '';
    
    if (date) {
      events.push({
        store: store.id,
        storeName: store.name,
        city: store.city,
        date,
        time,
        title,
        description: '',
        url,
        format: detectFormat(title),
      });
    }
  }
  
  // Also grab from calendar section: "TIME - [Event Name](url)" after date markers
  const calLines = text.split('\n');
  let currentCalDate = null;
  const now = new Date();
  const currentMonth = now.getMonth();
  const currentYear = now.getFullYear();
  
  for (const line of calLines) {
    // Calendar day markers like "[3](url)" or just a number
    const dayMarker = line.match(/^\[(\d{1,2})\]\(/);
    if (dayMarker) {
      const day = parseInt(dayMarker[1], 10);
      // Infer month from context — these are near-current
      // We'll use current month, adjusting if day < today and we're near month end
      let month = currentMonth;
      let year = currentYear;
      if (day < now.getDate() - 7) {
        month = currentMonth + 1;
        if (month > 11) { month = 0; year++; }
      }
      currentCalDate = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
    
    // Calendar event: "TIME - [Event](url)"
    const calEvent = line.match(/(\d{1,2}:\d{2}\s*[AP]M)\s*-\s*\[([^\]]+)\]\(([^)]+)\)/i);
    if (calEvent && currentCalDate) {
      const time = calEvent[1];
      const title = calEvent[2].trim();
      const url = calEvent[3].trim();
      
      if (isMtgEvent(title)) {
        // Deduplicate — check if we already have this event
        const isDupe = events.some(e => e.date === currentCalDate && e.title === title);
        if (!isDupe) {
          events.push({
            store: store.id,
            storeName: store.name,
            city: store.city,
            date: currentCalDate,
            time,
            title,
            description: '',
            url,
            format: detectFormat(title),
          });
        }
      }
    }
  }
  
  return events;
}

// ── Scraper: Game Theory ───────────────────────────────────────────
// Game Theory uses BinderPOS which renders a JS calendar.
// The Jina output shows event names but not specific dates.
// We'll parse what we can — mostly FNM is every Friday.
async function scrapeGameTheory(store) {
  const text = await fetchText(store.jinaUrl);
  const events = [];
  
  // The BinderPOS page shows event names and descriptions but dates are in JS.
  // We can extract the event types and generate upcoming recurring events.
  // FNM is explicitly mentioned as weekly (Fridays) with Modern + rotating formats.
  
  const hasFNM = text.toLowerCase().includes('fnm') || text.toLowerCase().includes('friday night magic');
  
  if (hasFNM) {
    // Generate next 4 Fridays
    const now = new Date();
    for (let i = 0; i < 4; i++) {
      const d = new Date(now);
      d.setDate(d.getDate() + ((5 - d.getDay() + 7) % 7) + (i * 7)); // Next Friday + i weeks
      if (d.getDay() !== 5) continue;
      const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      
      events.push({
        store: store.id,
        storeName: store.name,
        city: store.city,
        date: dateStr,
        time: '',
        title: 'FNM (Modern + rotating format)',
        description: 'Friday Night Magic at Game Theory Duraleigh. Modern is always available, plus rotating formats (Pioneer, Legacy, latest set).',
        url: store.eventsUrl,
        format: 'Modern',
      });
    }
  }
  
  return events;
}

// ── Scraper: Shuffle N Roll ────────────────────────────────────────
// Uses BinderPOS with image-based calendar. Event names are in image alt text.
async function scrapeShuffleNRoll(store) {
  const text = await fetchText(store.jinaUrl);
  const events = [];
  
  // Parse the calendar table. Image alt texts contain event names.
  // Calendar structure: | day | with images having alt text like "Wednesday Night Commander"
  // We need to map day numbers to dates within the calendar month (March 2026 from context)
  
  // Extract month/year from heading
  const monthYearMatch = text.match(/(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})/i);
  let calMonth = new Date().getMonth();
  let calYear = new Date().getFullYear();
  if (monthYearMatch) {
    calMonth = MONTHS[monthYearMatch[1].toLowerCase()];
    calYear = parseInt(monthYearMatch[2], 10);
  }
  
  // Parse calendar cells. Each cell starts with a day number and may contain image alt texts.
  // Look for patterns like: "| 7 ![Event Name](...) ![Event Name](...) |"
  const lines = text.split('\n');
  
  for (const line of lines) {
    if (!line.includes('![')) continue;
    
    // Find day numbers in the calendar row
    // Cells in the table row: | content | content | ...
    const cells = line.split('|').filter(c => c.trim());
    
    for (const cell of cells) {
      // Extract the day number (first standalone number in the cell)
      const dayMatch = cell.match(/^\s*(\d{1,2})\s/);
      if (!dayMatch) continue;
      const day = parseInt(dayMatch[1], 10);
      if (day < 1 || day > 31) continue;
      
      const dateStr = `${calYear}-${String(calMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      
      // Extract image alt texts (event names)
      const imgPattern = /!\[(?:Image\s*\d+:\s*)?([^\]]+)\]/g;
      let imgMatch;
      while ((imgMatch = imgPattern.exec(cell)) !== null) {
        const eventName = imgMatch[1].trim();
        if (isMtgEvent(eventName)) {
          // Avoid duplicates
          const isDupe = events.some(e => e.date === dateStr && e.title === eventName);
          if (!isDupe) {
            events.push({
              store: store.id,
              storeName: store.name,
              city: store.city,
              date: dateStr,
              time: '',
              title: eventName,
              description: '',
              url: store.eventsUrl,
              format: detectFormat(eventName),
            });
          }
        }
      }
    }
  }
  
  return events;
}

// ── Scraper: Picante TCG ───────────────────────────────────────────
// Picante has weekly recurring events, not a dated calendar.
// We'll generate recurring events for the next 4 weeks.
async function scrapePicanteTCG(store) {
  const events = [];
  const now = new Date();
  
  // Weekly schedule from their site:
  // TUE all day - Commander (casual)
  // WED 6:00 PM - Standard
  // THU all day - Commander (casual)
  // FRI 6:30 PM - Yu-Gi-Oh (not MTG)
  // SAT 2:00 PM - Yu-Gi-Oh (not MTG)
  // SUN 2:00 PM - Standard, 6:00 PM - Standard
  
  // MTG events: Tuesday (Commander), Wednesday (Standard), Thursday (Commander), Sunday (Standard)
  
  const weeklyMtgEvents = [
    { day: 2, title: 'Commander Casual Play', time: 'All Day', format: 'Commander/EDH' },
    { day: 3, title: 'Standard Tournament', time: '6:00 PM', format: 'Standard' },
    { day: 4, title: 'Commander Casual Play', time: 'All Day', format: 'Commander/EDH' },
    { day: 0, title: 'Standard Tournament', time: '2:00 PM', format: 'Standard' },
    { day: 0, title: 'Standard Tournament (Evening)', time: '6:00 PM', format: 'Standard' },
  ];
  
  for (let week = 0; week < 4; week++) {
    for (const evt of weeklyMtgEvents) {
      const d = new Date(now);
      const diff = (evt.day - d.getDay() + 7) % 7 + (week * 7);
      d.setDate(d.getDate() + diff);
      // Skip if in the past
      if (d < now && week === 0) continue;
      
      const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      
      events.push({
        store: store.id,
        storeName: store.name,
        city: store.city,
        date: dateStr,
        time: evt.time,
        title: evt.title,
        description: 'Weekly recurring event at Picante TCG.',
        url: store.eventsUrl,
        format: evt.format,
      });
    }
  }
  
  return events;
}

// ── Scraper: Dragon's Hoard ────────────────────────────────────────
async function scrapeDragonsHoard(store) {
  const text = await fetchText(store.jinaUrl);
  const events = [];
  
  // Dragon's Hoard uses Squarespace calendar. Events are embedded in the table.
  // Pattern: "[TIME Magic the Gathering Event Title](url)"
  // Or: "* [TIME Event Title](url)"
  
  // Extract events from the calendar HTML
  // Links pattern: [Magic the Gathering ...](url)
  const linkPattern = /\[(?:(\d{1,2}:\d{2}\s*[AP]M)\s*(?:\d{1,2}:\d{2}\s*)?\d{1,2}:\d{2}\s*[AP]M\s+)?([^\]]+)\]\((https:\/\/www\.dragonshoardnc\.com\/schedule\/[^)]+)\)/gi;
  
  let match;
  const seenUrls = new Set();
  
  // Also try to get dates from context
  // The calendar has day headers like "Sat 1", "Sun 8", etc. within cells
  // Let's parse line by line
  const lines = text.split('\n');
  let currentCalDate = null;
  
  // Determine the calendar month
  const calMonthMatch = text.match(/Su\s+\|\s+Mo\s+\|\s+Tu\s+\|\s+We\s+\|\s+Th\s+\|\s+Fr\s+\|\s+Sa/);
  // Look for month context — the calendar shows March 2026 based on content
  // We'll extract from "Events" section context
  
  for (const line of lines) {
    // Day headers: "Sun 1", "Mon 2", "Fri 20", etc.
    const dayHeaders = line.match(/(?:Sun|Mon|Tue|Wed|Thu|Fri|Sat)\s+(\d{1,2})/g);
    if (dayHeaders) {
      for (const dh of dayHeaders) {
        const dm = dh.match(/(\d{1,2})/);
        if (dm) {
          const day = parseInt(dm[1], 10);
          // Determine month — check the page content for context
          // Events shown are in March 2026
          let month = new Date().getMonth();
          let year = new Date().getFullYear();
          currentCalDate = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        }
      }
    }
    
    // Find event links with times
    const eventLinks = [...line.matchAll(/(\d{1,2}:\d{2}\s*[AP]M)\s*(?:\d{1,2}:\d{2}\s*)?\d{1,2}:\d{2}\s*[AP]M\s+([^\]]*?)\]\((https:\/\/www\.dragonshoardnc\.com\/schedule\/[^)]+)\)/gi)];
    
    if (eventLinks.length === 0) {
      // Try simpler pattern
      const simpleLinks = [...line.matchAll(/\[([^\]]+)\]\((https:\/\/www\.dragonshoardnc\.com\/schedule\/[^)]+)\)/g)];
      for (const sl of simpleLinks) {
        const title = sl[1].trim();
        const url = sl[2];
        if (seenUrls.has(url)) continue;
        
        if (isMtgEvent(title)) {
          seenUrls.add(url);
          
          // Extract time if present before the link
          const timeMatch = title.match(/^(\d{1,2}:\d{2}\s*[AP]M)/i);
          const time = timeMatch ? timeMatch[1] : '';
          const cleanTitle = title.replace(/^\d{1,2}:\d{2}\s*[AP]M\s*\d{1,2}:\d{2}\s*\d{1,2}:\d{2}\s*[AP]M\s*/i, '').trim();
          
          events.push({
            store: store.id,
            storeName: store.name,
            city: store.city,
            date: currentCalDate || '',
            time,
            title: cleanTitle || title,
            description: '',
            url,
            format: detectFormat(title),
          });
        }
      }
    }
    
    for (const el of eventLinks) {
      const time = el[1];
      const title = el[2].trim();
      const url = el[3];
      if (seenUrls.has(url)) continue;
      
      if (isMtgEvent(title)) {
        seenUrls.add(url);
        events.push({
          store: store.id,
          storeName: store.name,
          city: store.city,
          date: currentCalDate || '',
          time,
          title,
          description: '',
          url,
          format: detectFormat(title),
        });
      }
    }
  }
  
  return events;
}

// ── Main ───────────────────────────────────────────────────────────
const scrapers = {
  'atomic-empire': scrapeAtomicEmpire,
  'gathering-place': scrapeGatheringPlace,
  'game-theory': scrapeGameTheory,
  'shuffle-n-roll': scrapeShuffleNRoll,
  'picante-tcg': scrapePicanteTCG,
  'dragons-hoard': scrapeDragonsHoard,
};

async function main() {
  console.log('🃏 MTG Events Scraper starting...\n');
  
  let allEvents = [];
  const results = [];
  
  for (const store of STORES) {
    const scraper = scrapers[store.id];
    try {
      console.log(`  Scraping ${store.name} (${store.city})...`);
      const events = await scraper(store);
      console.log(`    ✅ Found ${events.length} MTG events`);
      allEvents.push(...events);
      results.push({ store: store.name, status: 'ok', count: events.length });
    } catch (err) {
      console.error(`    ❌ Failed: ${err.message}`);
      results.push({ store: store.name, status: 'error', error: err.message });
    }
  }
  
  // Sort by date
  allEvents.sort((a, b) => {
    if (a.date !== b.date) return a.date.localeCompare(b.date);
    return a.time.localeCompare(b.time);
  });
  
  // Filter out past events (keep today and forward)
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  allEvents = allEvents.filter(e => !e.date || e.date >= todayStr);
  
  // Deduplicate by store+date+title
  const seen = new Set();
  allEvents = allEvents.filter(e => {
    const key = `${e.store}|${e.date}|${e.title}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  
  const output = {
    lastUpdated: new Date().toISOString(),
    stores: STORES.map(s => ({ id: s.id, name: s.name, city: s.city, url: s.eventsUrl })),
    events: allEvents,
  };
  
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(join(DATA_DIR, 'events.json'), JSON.stringify(output, null, 2));
  
  console.log(`\n📊 Results:`);
  for (const r of results) {
    console.log(`  ${r.status === 'ok' ? '✅' : '❌'} ${r.store}: ${r.status === 'ok' ? `${r.count} events` : r.error}`);
  }
  console.log(`\n✨ Total: ${allEvents.length} MTG events written to data/events.json`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
