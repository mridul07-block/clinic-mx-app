/**
 * Generated people for the demo data (docs/runbooks/demo-data.md; rule 12: never real data). The
 * names are common first and last names put together at random, so they look like the clinic's
 * patients without being anyone in particular. A seeded generator gives the same people each run.
 */

const femaleNames = [
  'Aditi',
  'Ananya',
  'Bhavana',
  'Deepa',
  'Divya',
  'Gayathri',
  'Ishita',
  'Kavya',
  'Lakshmi',
  'Meera',
  'Neha',
  'Nikita',
  'Pooja',
  'Priya',
  'Radhika',
  'Rashmi',
  'Riya',
  'Sahana',
  'Shreya',
  'Sneha',
  'Swathi',
  'Tanvi',
  'Vaishnavi',
  'Zoya',
];

const maleNames = [
  'Aarav',
  'Abhishek',
  'Aditya',
  'Arjun',
  'Darshan',
  'Farhan',
  'Gautam',
  'Harsha',
  'Karthik',
  'Kiran',
  'Manoj',
  'Naveen',
  'Nikhil',
  'Pranav',
  'Rahul',
  'Rohan',
  'Sandeep',
  'Siddharth',
  'Suresh',
  'Tejas',
  'Varun',
  'Vikram',
  'Vivek',
  'Yash',
];

const lastNames = [
  'Acharya',
  'Bhat',
  'Chopra',
  'Das',
  'Fernandes',
  'Gowda',
  'Hegde',
  'Iyer',
  'Jain',
  'Kamath',
  'Khan',
  'Kulkarni',
  'Menon',
  'Mehta',
  'Nair',
  'Pai',
  'Patil',
  'Raman',
  'Rao',
  'Reddy',
  'Shetty',
  'Sharma',
  'Singh',
  'Srinivasan',
  'Thomas',
  'Verma',
];

const occupations = [
  'Software engineer',
  'Teacher',
  'Student',
  'Product manager',
  'Accountant',
  'Designer',
  'Retired',
  'Doctor',
  'Sales manager',
  'Homemaker',
  'Runner',
  'Architect',
];

/** The domain every demo patient's email is on: the marker that tells demo rows apart. */
export const DEMO_EMAIL_DOMAIN = 'demo.clinicmx.test';

/** A demo patient's marker email for a slug such as `hsr-07` or `hsr-t20261031-1`. */
export function demoEmail(slug: string): string {
  return `${slug}@${DEMO_EMAIL_DOMAIN}`;
}

/** A small seeded generator (mulberry32): the same seed gives the same people. */
export function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A number for a text, so each slug always makes the same person. */
export function hashText(text: string): number {
  let hash = 2166136261;
  for (const char of text) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return hash >>> 0;
}

export function pick<T>(random: () => number, from: readonly T[]): T {
  const item = from[Math.floor(random() * from.length)];
  if (item === undefined) throw new Error('Nothing to pick from.');
  return item;
}

export function between(random: () => number, low: number, high: number): number {
  return low + Math.floor(random() * (high - low + 1));
}

export interface DemoPerson {
  name: string;
  phone: string;
  email: string;
  sex: 'female' | 'male';
  dateOfBirth: string;
  occupation: string;
}

/** The made up person for a slug: a name, a +91 99 mobile, a birthday, a job. */
export function demoPerson(slug: string): DemoPerson {
  const random = seeded(hashText(slug));
  const sex = random() < 0.5 ? 'female' : 'male';
  const first = pick(random, sex === 'female' ? femaleNames : maleNames);
  const digits = Array.from({ length: 8 }, () => between(random, 0, 9)).join('');
  const year = between(random, 1958, 2006);
  const month = String(between(random, 1, 12)).padStart(2, '0');
  const day = String(between(random, 1, 28)).padStart(2, '0');
  return {
    name: `${first} ${pick(random, lastNames)}`,
    phone: `+9199${digits}`,
    email: demoEmail(slug),
    sex,
    dateOfBirth: `${year}-${month}-${day}`,
    occupation: pick(random, occupations),
  };
}
