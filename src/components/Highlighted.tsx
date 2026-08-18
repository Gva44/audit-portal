// Renders a ts_headline snippet without dangerouslySetInnerHTML: the API delimits
// matched terms with a control character (see HIGHLIGHT_DELIM in the search route)
// instead of HTML tags, since the surrounding text comes from user-uploaded documents.
const DELIM = String.fromCharCode(1);

export default function Highlighted({ text }: { text: string }) {
  const parts = text.split(DELIM);
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <strong key={i} className="text-neutral-900">
            {part}
          </strong>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </>
  );
}
