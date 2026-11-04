//! File and document-content search for the Spotlight, through GNOME's own index.
//!
//! Tracker (LocalSearch) already indexes the user's folders, including the text inside PDF,
//! DOCX, ODT and plain text. This module asks it over D-Bus (SPARQL) instead of building a second
//! index: names with a substring match, contents with full-text search and a snippet around the
//! match. Nothing is stored and nothing leaves the computer.

use std::collections::HashMap;
use std::io::Read;
use std::os::fd::OwnedFd;
use std::time::Duration;

use zbus::{Connection, OwnedFd as DBusFd, Variant};

const TRACKER_BUS: &str = "org.freedesktop.Tracker3.Miner.Files";
const TRACKER_PATH: &str = "/org/freedesktop/Tracker3/Endpoint";
const TRACKER_IFACE: &str = "org.freedesktop.Tracker3.Endpoint";

/// Tracker must answer within this; the Spotlight shows the applications meanwhile
const QUERY_TIMEOUT: Duration = Duration::from_millis(2500);
/// Rows fetched per query before ranking; the caller's limit is applied after
const FETCH_ROWS: usize = 40;
const SNIPPET_MAX: usize = 160;
const TERMS_MAX: usize = 6;
const MIME_FOLDER: &str = "inode/directory";

/// Marks around the matched words in a snippet; the Spotlight draws them bold
pub const MATCH_OPEN: char = '«';
pub const MATCH_CLOSE: char = '»';

#[derive(Debug, Clone, PartialEq)]
pub struct Hit {
    /// "file", "folder" (name matches) or "document" (content matches)
    pub kind: &'static str,
    pub title: String,
    pub uri: String,
    pub snippet: String,
    pub mime: String,
}

/// Search terms made safe for SPARQL and for Tracker's full-text syntax: lower case, only
/// letters and digits (plus . _ - when `filename`), at most TERMS_MAX terms
fn terms(query: &str, filename: bool) -> Vec<String> {
    query
        .split_whitespace()
        .map(|term| {
            term.chars()
                .filter(|c| c.is_alphanumeric() || (filename && matches!(c, '.' | '_' | '-')))
                .flat_map(char::to_lowercase)
                .collect::<String>()
        })
        .filter(|term| !term.is_empty())
        .take(TERMS_MAX)
        .collect()
}

fn name_query(terms: &[String]) -> String {
    let filter = terms
        .iter()
        .map(|t| format!("CONTAINS(LCASE(?n), \"{t}\")"))
        .collect::<Vec<_>>()
        .join(" && ");
    format!(
        "SELECT DISTINCT ?u ?n ?mime ?mod WHERE {{ \
         ?f a nfo:FileDataObject ; nie:url ?u ; nfo:fileName ?n ; nfo:fileLastModified ?mod . \
         OPTIONAL {{ ?f nie:interpretedAs/nie:mimeType ?mime }} FILTER({filter}) }} \
         ORDER BY DESC(?mod) LIMIT {FETCH_ROWS}"
    )
}

fn content_query(terms: &[String]) -> String {
    let fts = terms.iter().map(|t| format!("{t}*")).collect::<Vec<_>>().join(" ");
    format!(
        "SELECT DISTINCT ?url ?n (fts:snippet(?d, \"{MATCH_OPEN}\", \"{MATCH_CLOSE}\", \"…\", 14) AS ?s) ?mime ?mod WHERE {{ \
         ?d a nfo:Document ; fts:match \"{fts}\" ; nie:isStoredAs ?f . \
         ?f nie:url ?url ; nfo:fileName ?n ; nfo:fileLastModified ?mod . OPTIONAL {{ ?d nie:mimeType ?mime }} }} \
         ORDER BY DESC(fts:rank(?d)) LIMIT {FETCH_ROWS}"
    )
}

/// Rows of a Tracker cursor stream. Each row is: column count (i32), a type per column (i32),
/// the end offset of each value (i32), then the values as NUL-terminated text (all little endian).
fn parse_rows(data: &[u8]) -> Vec<Vec<String>> {
    fn int(data: &[u8], at: usize) -> Option<usize> {
        let bytes: [u8; 4] = data.get(at..at + 4)?.try_into().ok()?;
        usize::try_from(i32::from_le_bytes(bytes)).ok()
    }

    let mut rows = Vec::new();
    let mut at = 0;
    while at < data.len() {
        let Some(columns) = int(data, at) else { break };
        at += 4;
        let mut ends = Vec::with_capacity(columns);
        for column in 0..columns {
            let Some(end) = int(data, at + 4 * columns + 4 * column) else { return rows };
            ends.push(end);
        }
        at += 8 * columns;
        let Some(&last) = ends.last() else { break };
        let Some(text) = data.get(at..at + last) else { break };
        let mut start = 0;
        let row = ends
            .iter()
            .map(|&end| {
                let value = String::from_utf8_lossy(text.get(start..end).unwrap_or_default()).into_owned();
                start = end + 1;
                value
            })
            .collect();
        rows.push(row);
        at += last + 1;
    }
    rows
}

/// One SPARQL query on the Tracker endpoint; the result rows come through a pipe
async fn run_query(conn: &Connection, query: &str) -> zbus::Result<Vec<Vec<String>>> {
    let (mut reader, writer) = std::io::pipe().map_err(zbus::Error::from)?;
    // Read while Tracker writes: a large result would otherwise fill the pipe and block it
    let reading = tokio::task::spawn_blocking(move || {
        let mut data = Vec::new();
        reader.read_to_end(&mut data).map(|_| data)
    });
    let args: HashMap<&str, Variant<'_>> = HashMap::new();
    let body = (query, DBusFd::from(OwnedFd::from(writer)), args);
    let call = conn.call_method(Some(TRACKER_BUS), TRACKER_PATH, Some(TRACKER_IFACE), "Query", &body);
    // On timeout the call is dropped, our end of the pipe closes and the reader ends
    let sent = tokio::time::timeout(QUERY_TIMEOUT, call).await;
    // Our copy of the write end must be closed before waiting: the reader ends at EOF
    drop(body);
    let data = reading.await.ok().and_then(Result::ok).unwrap_or_default();
    match sent {
        Ok(Ok(_)) => Ok(parse_rows(&data)),
        Ok(Err(e)) => Err(e),
        Err(_) => Ok(Vec::new()),
    }
}

/// Snippets come with line breaks from the document; the Spotlight shows one short line
fn one_line(text: &str) -> String {
    let flat: Vec<&str> = text.split_whitespace().collect();
    flat.join(" ").chars().take(SNIPPET_MAX).collect()
}

fn hit(kind_file: bool, row: &[String]) -> Option<Hit> {
    let [uri, title, rest @ ..] = row else { return None };
    // Name rows are (f, n, mime, mod); content rows are (f, n, snippet, mime, mod)
    let (snippet, mime) = match (kind_file, rest) {
        (true, [mime, ..]) => (String::new(), mime.clone()),
        (false, [snippet, mime, ..]) => (one_line(snippet), mime.clone()),
        _ => return None,
    };
    let kind = if mime == MIME_FOLDER {
        "folder"
    } else if kind_file {
        "file"
    } else {
        "document"
    };
    Some(Hit { kind, title: title.clone(), uri: uri.clone(), snippet, mime })
}

/// Name matches first (names that start with the first term before the others, newest first),
/// then files that only match by content. A file found by both shows once, with its snippet.
fn merge(first_term: &str, names: &[Vec<String>], contents: &[Vec<String>], limit: usize) -> Vec<Hit> {
    let mut by_name: Vec<(&Vec<String>, bool)> = names
        .iter()
        .map(|row| (row, row.get(1).is_some_and(|n| n.to_lowercase().starts_with(first_term))))
        .collect();
    // Stable sort: the rows already come newest first
    by_name.sort_by_key(|&(_, starts)| !starts);

    let snippets: HashMap<&str, String> = contents
        .iter()
        .filter_map(|row| Some((row.first()?.as_str(), one_line(row.get(2)?))))
        .collect();

    let mut hits: Vec<Hit> = by_name
        .into_iter()
        .filter_map(|(row, _)| hit(true, row))
        .map(|mut h| {
            if let Some(snippet) = snippets.get(h.uri.as_str()) {
                h.snippet = snippet.clone();
            }
            h
        })
        .take(limit)
        .collect();

    let named: Vec<String> = hits.iter().map(|h| h.uri.clone()).collect();
    hits.extend(
        contents
            .iter()
            .filter(|row| row.first().is_some_and(|uri| !named.contains(uri)))
            .filter_map(|row| hit(false, row))
            .take(limit),
    );
    hits
}

/// Files by name and, when `content` is set, by the text inside them. Tracker not running, not
/// answering or not indexing yet gives an empty list, never an error.
pub async fn search(conn: &Connection, query: &str, limit: usize, files: bool, content: bool) -> Vec<Hit> {
    let name_terms = terms(query, true);
    let content_terms: Vec<String> = terms(query, false).into_iter().filter(|t| t.chars().count() >= 2).collect();
    if name_terms.is_empty() || (!files && !content) {
        return Vec::new();
    }

    let names = async {
        if !files {
            return Vec::new();
        }
        run_query(conn, &name_query(&name_terms)).await.unwrap_or_default()
    };
    let contents = async {
        if !content || content_terms.is_empty() {
            return Vec::new();
        }
        run_query(conn, &content_query(&content_terms)).await.unwrap_or_default()
    };
    let (names, contents) = tokio::join!(names, contents);
    // With files off, content hits stay: they are "documents" the user asked to search inside
    merge(&name_terms[0], &names, &contents, limit)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn row(values: &[&str]) -> Vec<String> {
        values.iter().map(|v| v.to_string()).collect()
    }

    /// A cursor row as Tracker writes it
    fn encode(values: &[&str]) -> Vec<u8> {
        let mut out = Vec::new();
        out.extend((values.len() as i32).to_le_bytes());
        for _ in values {
            out.extend(2i32.to_le_bytes());
        }
        let mut end = 0;
        for v in values {
            out.extend((end + v.len() as i32).to_le_bytes());
            end += v.len() as i32 + 1;
        }
        for v in values {
            out.extend(v.as_bytes());
            out.push(0);
        }
        out
    }

    #[test]
    fn terms_are_safe_for_sparql() {
        assert_eq!(terms("Laporan  \"x\\y\" ; DROP", false), vec!["laporan", "xy", "drop"]);
        assert_eq!(terms("a.b_c-d 'e'", true), vec!["a.b_c-d", "e"]);
        assert_eq!(terms("   ", false), Vec::<String>::new());
        assert_eq!(terms("a b c d e f g h", false).len(), TERMS_MAX);
    }

    #[test]
    fn queries_carry_the_terms() {
        let q = name_query(&["foo".into(), "bar".into()]);
        assert!(q.contains("CONTAINS(LCASE(?n), \"foo\") && CONTAINS(LCASE(?n), \"bar\")"));
        assert!(content_query(&["foo".into(), "bar".into()]).contains("fts:match \"foo* bar*\""));
    }

    #[test]
    fn cursor_rows_are_parsed() {
        let mut data = encode(&["file:///a%20b.pdf", "a b.pdf", "application/pdf"]);
        data.extend(encode(&["file:///c", "", "inode/directory"]));
        assert_eq!(
            parse_rows(&data),
            vec![row(&["file:///a%20b.pdf", "a b.pdf", "application/pdf"]), row(&["file:///c", "", "inode/directory"])]
        );
        // A cut-off stream gives the rows before the cut, never a panic
        assert_eq!(parse_rows(&data[..data.len() - 5]).len(), 1);
        assert!(parse_rows(&[1, 0]).is_empty());
    }

    #[test]
    fn names_rank_before_contents_and_files_show_once() {
        let names = vec![
            row(&["file:///old/xlaporan.txt", "xlaporan.txt", "text/plain", "2026-01-01"]),
            row(&["file:///new/laporan.docx", "laporan.docx", "application/msword", "2026-02-01"]),
            row(&["file:///dir/laporan", "laporan", MIME_FOLDER, "2026-03-01"]),
        ];
        let contents = vec![
            row(&["file:///new/laporan.docx", "laporan.docx", "isi «laporan»\nlengkap", "application/msword", "x"]),
            row(&["file:///other.pdf", "other.pdf", "ada «laporan» di sini", "application/pdf", "x"]),
        ];
        let hits = merge("laporan", &names, &contents, 8);
        let order: Vec<_> = hits.iter().map(|h| (h.kind, h.title.as_str())).collect();
        assert_eq!(
            order,
            vec![("file", "laporan.docx"), ("folder", "laporan"), ("file", "xlaporan.txt"), ("document", "other.pdf")]
        );
        assert_eq!(hits[0].snippet, "isi «laporan» lengkap");
    }

    #[test]
    fn limit_applies_per_group() {
        let names: Vec<_> = (0..5).map(|i| row(&[&format!("file:///{i}"), "laporan", "text/plain", "x"])).collect();
        let contents: Vec<_> = (0..5).map(|i| row(&[&format!("file:///c{i}"), "c", "s", "text/plain", "x"])).collect();
        let hits = merge("laporan", &names, &contents, 2);
        assert_eq!(hits.iter().filter(|h| h.kind == "file").count(), 2);
        assert_eq!(hits.iter().filter(|h| h.kind == "document").count(), 2);
    }
}
