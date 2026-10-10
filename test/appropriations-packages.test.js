#!/usr/bin/env node
//
// Appropriations.divisions / packageLike: which subcommittees' bills a minibus or omnibus carries, read from the headings of its text. The headings below are the real
// ones from the enrolled texts of P.L. 119-74 (H.R. 6938), 119-86 (H.R. 7147), 119-37 (H.R. 5371), 119-75 (H.R. 7148, which has no division C), 118-42 (H.R. 4366) and
// 118-47 (H.R. 2882), as govinfo prints them. No network.

const assert = require('assert');
const AP = require('../lib/appropriations.js');

let n = 0;
const ok = (name, fn) => { fn(); n++; console.log('ok  ' + name); };
const pre = (...heads) => '<html><body><pre>' + heads.join('\n\nTitle I--Something\n\n') + '</pre></body></html>';

ok('P.L. 119-74 (a minibus) carries Commerce-Justice-Science, Energy and Water and Interior', () => {
  const t = pre('DIVISION A--COMMERCE, JUSTICE, SCIENCE, AND RELATED AGENCIES APPROPRIATIONS ACT, 2026', 'DIVISION B--ENERGY AND WATER DEVELOPMENT AND RELATED AGENCIES APPROPRIATIONS ACT, 2026', 'DIVISION C--DEPARTMENT OF THE INTERIOR, ENVIRONMENT, AND RELATED AGENCIES APPROPRIATIONS ACT, 2026');
  assert.deepStrictEqual(AP.divisions(t, 2026), ['Commerce, Justice, Science', 'Energy and Water', 'Interior, Environment']);
});

ok('P.L. 119-86 carries Homeland Security alone, though the Act is also a continuing resolution', () => {
  assert.deepStrictEqual(AP.divisions(pre('DIVISION A--DEPARTMENT OF HOMELAND SECURITY APPROPRIATIONS ACT, 2026', 'DIVISION B--FURTHER ADDITIONAL CONTINUING APPROPRIATIONS ACT, 2026'), 2026), ['Homeland Security']);
});

ok('P.L. 119-37: a continuing resolution division and three regular ones, lettered out of order', () => {
  const t = pre('DIVISION A--CONTINUING APPROPRIATIONS ACT, 2026', 'DIVISION B--AGRICULTURE, RURAL DEVELOPMENT, FOOD AND DRUG ADMINISTRATION, AND RELATED AGENCY APPROPRIATIONS ACT, 2026', 'DIVISION C--LEGISLATIVE BRANCH APPROPRIATIONS ACT, 2026', 'DIVISION D--MILITARY CONSTRUCTION, VETERANS AFFAIRS, AND RELATED AGENCIES APPROPRIATIONS ACT, 2026');
  assert.deepStrictEqual(AP.divisions(t, 2026).sort(), ['Agriculture', 'Legislative Branch', 'Military Construction, VA']);
});

ok('P.L. 119-75 has no division C, and its other matters and continuing divisions carry no bill', () => {
  const t = pre('DIVISION A--DEPARTMENT OF DEFENSE APPROPRIATIONS ACT, 2026', 'DIVISION B--DEPARTMENTS OF LABOR, HEALTH AND HUMAN SERVICES, AND EDUCATION, AND RELATED AGENCIES APPROPRIATIONS ACT, 2026', 'DIVISION D--TRANSPORTATION, HOUSING AND URBAN DEVELOPMENT, AND RELATED AGENCIES APPROPRIATIONS ACT, 2026', 'DIVISION E--FINANCIAL SERVICES AND GENERAL GOVERNMENT APPROPRIATIONS ACT, 2026', 'DIVISION F--NATIONAL SECURITY, DEPARTMENT OF STATE, AND RELATED PROGRAMS APPROPRIATIONS ACT, 2026', 'DIVISION G--OTHER MATTERS', 'DIVISION H--FURTHER CONTINUING APPROPRIATIONS ACT, 2026');
  assert.deepStrictEqual(AP.divisions(t, 2026), ['Defense', 'Labor, HHS, Education', 'Transportation, HUD', 'Financial Services', 'State, National Security']);
});

ok('govinfo wraps a long heading over two lines; the heading is still read, and one division never swallows the next', () => {
  const t = '<pre>DIVISION B--DEPARTMENTS OF LABOR, HEALTH AND HUMAN SERVICES, AND EDUCATION, AND RELATED AGENCIES\nAPPROPRIATIONS ACT, 2026\n\nTitle I\n\nDIVISION G--OTHER MATTERS\n\nDIVISION H--FURTHER CONTINUING APPROPRIATIONS ACT, 2026\nDIVISION D--TRANSPORTATION, HOUSING AND URBAN DEVELOPMENT, AND RELATED AGENCIES\nAPPROPRIATIONS ACT, 2026</pre>';
  assert.deepStrictEqual(AP.divisions(t, 2026), ['Labor, HHS, Education', 'Transportation, HUD']);
});

ok('the fiscal year is the panel\'s: another year\'s acts in the same text are not credited', () => {
  const t = pre('DIVISION A--DEPARTMENT OF DEFENSE APPROPRIATIONS ACT, 2024', 'DIVISION B--FINANCIAL SERVICES AND GENERAL GOVERNMENT APPROPRIATIONS ACT, 2024');
  assert.deepStrictEqual(AP.divisions(t, 2024), ['Defense', 'Financial Services']);
  assert.deepStrictEqual(AP.divisions(t, 2025), []);
});

ok('a mention of an Act in the body, in ordinary case, or a heading with no DIVISION, is not a division', () => {
  assert.deepStrictEqual(AP.divisions('Sec. 5. The Department of Defense Appropriations Act, 2026 (division A) is amended. DEPARTMENT OF DEFENSE APPROPRIATIONS ACT, 2026 TITLE I', 2026), []);
  assert.deepStrictEqual(AP.divisions('', 2026), []);
  assert.deepStrictEqual(AP.divisions(null, 2026), []);
});

ok('packageLike: consolidated, continuing, extensions or several subcommittees; not a bill with one subcommittee\'s name', () => {
  assert.strictEqual(AP.packageLike('Consolidated Appropriations Act, 2027'), true);
  assert.strictEqual(AP.packageLike('Commerce, Justice, Science; Energy and Water Development; and Interior and Environment Appropriations Act, 2026'), true);
  assert.strictEqual(AP.packageLike('Continuing Appropriations, Agriculture, Legislative Branch, Military Construction and Veterans Affairs, and Extensions Act, 2026'), true);
  assert.strictEqual(AP.packageLike('Homeland Security and Further Additional Continuing Appropriations Act, 2026.'), true);
  assert.strictEqual(AP.packageLike('Agriculture, Rural Development, Food and Drug Administration, and Related Agencies Appropriations Act, 2027'), false);
  assert.strictEqual(AP.packageLike('AGOA Extension Act'), false);
});

console.log(`\n${n} passed`);
