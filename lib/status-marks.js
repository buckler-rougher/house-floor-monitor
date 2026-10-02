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
    // Both marks are stroked, at one width, and both are centred on the box.
    //
    // The cross used to be a filled polygon beside a stroked tick, so at the same
    // nominal size it read heavier: a fill is a solid, a stroke is a line. They
    // now differ only in shape. The tick's bounding box ran from y 1.6 to 7.1, so
    // its middle sat at 4.35 in a box centred on 4.5 and the glyph looked high in
    // its circle; shifted by the difference. The cross spans 1.7 to 7.3, which is
    // the tick's footprint (6.4 by 5.5) rounded to a square.
    const STROKE = 'fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"';
    const tick = (px) => `<svg width="${px}" height="${px}" viewBox="0 0 9 9" style="display:block"><path ${STROKE} d="M1.3,4.95 L3.6,7.25 L7.7,1.75"/></svg>`;
    const cross = (px) => `<svg width="${px}" height="${px}" viewBox="0 0 9 9" style="display:block"><path ${STROKE} d="M1.7,1.7 L7.3,7.3 M7.3,1.7 L1.7,7.3"/></svg>`;

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
