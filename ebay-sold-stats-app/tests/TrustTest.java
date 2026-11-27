import java.net.URI;
import java.util.Locale;

/** Audit cycle 1 regression test (ADV-EBAYSS-2025-0007, finding ADV-001).
 *  Replicates the app's isTrustedEbayUrl() navigation/credential-bridge gate
 *  exactly (ebay-sold-stats-app/App/java/com/vibe/ebaysoldstats/MainActivity.java).
 *  Covers the prohibited-shortcut cases from the remediation spec: look-alike
 *  hosts such as evil-ebay.com and ebay.fr.evil.com must be BLOCKED, while
 *  all six supported marketplaces and signin subdomains must be allowed.
 */
public class TrustTest {
    static boolean isTrustedEbayUrl(String url) {
        if (url == null) return false;
        if (url.equals("about:blank") || url.startsWith("about:")) return true;
        try {
            String h = new URI(url).getHost();
            if (h == null) return false;
            h = h.toLowerCase(Locale.ROOT);
            for (String d : new String[]{"ebay.com", "ebay.co.uk", "ebay.fr",
                    "ebay.de", "ebay.es", "ebay.it"}) {
                if (h.equals(d) || h.endsWith("." + d)) return true;
            }
        } catch (Exception ignored) { }
        return false;
    }
    static int fails = 0;
    static void check(String name, boolean got, boolean want) {
        boolean ok = got == want;
        System.out.println((ok ? "PASS " : "FAIL ") + name);
        if (!ok) fails++;
    }
    public static void main(String[] a) {
        check("www.ebay.fr search allowed", isTrustedEbayUrl("https://www.ebay.fr/sch/i.html?_nkw=x"), true);
        check("ebay.com bare allowed", isTrustedEbayUrl("https://ebay.com/"), true);
        check("signin.ebay.fr allowed", isTrustedEbayUrl("https://signin.ebay.fr/signin"), true);
        check("about:blank allowed", isTrustedEbayUrl("about:blank"), true);
        check("evil-ebay.com BLOCKED", isTrustedEbayUrl("https://evil-ebay.com/x"), false);
        check("ebay.fr.evil.com BLOCKED", isTrustedEbayUrl("https://ebay.fr.evil.com/"), false);
        check("localhost BLOCKED", isTrustedEbayUrl("http://localhost:8080/x"), false);
        check("file scheme BLOCKED", isTrustedEbayUrl("file:///etc/passwd"), false);
        check("null BLOCKED", isTrustedEbayUrl(null), false);
        System.out.println(fails == 0 ? "ALL TRUST TESTS PASSED" : fails + " FAILED");
        System.exit(fails == 0 ? 0 : 1);
    }
}
