// Status marks: the tick and the cross, in one place.
//
// The same two SVGs were written out four times -- the amendment chips and the
// motion-to-recommit chip on the House board, the stage chips on the Senate one
// -- and then a fifth time as bare check and cross characters inside
// .bill-status. That fifth one is why a card's mark came out at 10px, the size
// of --fs-sm, sitting directly under an 11px chip drawn the proper way.
//
// One source, two sizes. A chip is 11px inside a 13px circle; a card's
// .bill-status circle is 20px, so it takes 13px to fill the same share of it.
//
// Loaded by both boards as a plain script, so it assigns to globalThis rather
// than exporting, the way every other lib/ module here does.

(() => {
    const tick = (px) => `<svg width="${px}" height="${px}" viewBox="0 0 9 9" style="display:block"><path fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" d="M1.3,4.8 L3.6,7.1 L7.7,1.6"/></svg>`;
    const cross = (px) => `<svg width="${px}" height="${px}" viewBox="0 0 9 9" style="display:block"><path fill="currentColor" d="M1.5,0 L4.5,3 L7.5,0 L9,1.5 L6,4.5 L9,7.5 L7.5,9 L4.5,6 L1.5,9 L0,7.5 L3,4.5 L0,1.5 Z"/></svg>`;

    // Anything that is not passed or failed gets nothing, which is what a
    // scheduled or pending circle has always drawn: the empty ring itself is
    // the statement that no vote has happened.
    const mark = (status, px) =>
        status === 'passed' ? tick(px) : status === 'failed' ? cross(px) : '';

    globalThis.StatusMarks = {
        chip: (status) => mark(status, 11),
        card: (status) => mark(status, 13),
    };
})();
