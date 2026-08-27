const assert = require('assert');
const { parseLetterboxd, parseMetacritic, slugify } = require('./server');

const lb = parseLetterboxd(`
<html><script type="application/ld+json">
{"@context":"https://schema.org","@type":"Movie","name":"Sisu","aggregateRating":{"@type":"AggregateRating","ratingValue":3.2,"ratingCount":228300,"bestRating":5}}
</script></html>`);
assert.deepStrictEqual(lb, { rating: 3.2, count: 228300 });

const mc = parseMetacritic(`
<html><head><title>Sisu Reviews - Metacritic</title></head><body>
<h1>Sisu</h1><div>Metascore</div><div>Generally Favorable</div>
<div>Based on 25 Critic Reviews</div><div>70</div>
<div>User score</div><div>Based on 216 User Ratings</div><div>6.7</div>
</body></html>`);
assert.strictEqual(mc.title, 'Sisu');
assert.strictEqual(mc.reviews, 25);
assert.strictEqual(mc.score, 70);
assert.strictEqual(slugify('Sisu: Road to Revenge'), 'sisu-road-to-revenge');
assert.strictEqual(slugify('Me & Earl and the Dying Girl'), 'me-and-earl-and-the-dying-girl');
console.log('Parser tests passed.');
