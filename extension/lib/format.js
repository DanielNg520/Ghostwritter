// Shared by settings.js and sidebar.js: both render a writing-sample
// category name (e.g. "cover_letter") as a human label (e.g. "Cover
// Letter"). One copy so a future formatting fix doesn't have to be made
// twice.
function capitalizeCategory(word) {
  return word
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}
