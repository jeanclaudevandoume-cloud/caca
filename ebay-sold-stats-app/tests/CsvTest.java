import java.util.List;
import java.util.ArrayList;

/** Audit cycle 1 regression test (ADV-EBAYSS-2025-0007, finding ADV-004).
 *  Replicates the app's splitCsvLine() quote-aware CSV parser exactly
 *  (ebay-sold-stats-app/App/java/com/vibe/ebaysoldstats/MainActivity.java).
 *  The ADV-004 failure case is included: before remediation the naive
 *  split(",", -1) parse rendered character as '"porte' and franchise as
 *  'mikasa' for a row whose goods column contains a quoted comma.
 */
public class CsvTest {
    static List<String> splitCsvLine(String ln) {
        List<String> out = new ArrayList<>();
        StringBuilder cur = new StringBuilder();
        boolean inQ = false;
        for (int i = 0; i < ln.length(); i++) {
            char c = ln.charAt(i);
            if (inQ) {
                if (c == '"') {
                    if (i + 1 < ln.length() && ln.charAt(i + 1) == '"') { cur.append('"'); i++; }
                    else inQ = false;
                } else cur.append(c);
            } else if (c == '"') inQ = true;
            else if (c == ',') out.add(cur.toString());
            else cur.append(c);
            if (c == ',' && !inQ) cur.setLength(0);
        }
        out.add(cur.toString());
        return out;
    }
    static int fails = 0;
    static void check(String name, Object got, Object want) {
        boolean ok = String.valueOf(got).equals(String.valueOf(want));
        System.out.println((ok ? "PASS " : "FAIL ") + name + " got='" + got + "' want='" + want + "'");
        if (!ok) fails++;
    }
    public static void main(String[] a) {
        // plain row must parse identically to the old naive split
        String plain = "q1,gojo satoru peluche,jujutsu kaisen,gojo satoru,peluche,182,21.87,21.87,EUR,69,66,3,ok";
        List<String> p = splitCsvLine(plain);
        check("plain cols", p.size(), 13);
        check("plain sold", p.get(p.size() - 8), "182");
        check("plain goods", p.get(p.size() - 9), "peluche");
        // ADV-004 original failure case: quoted comma inside goods column
        String qg = "q7,mikasa stand,attack on titan,mikasa,\"porte, cl\u00e9\",23,18.75,18.75,EUR,30,23,2,ok";
        List<String> p2 = splitCsvLine(qg);
        check("quoted cols", p2.size(), 13);
        check("quoted goods", p2.get(p2.size() - 9), "porte, cl\u00e9");
        check("quoted character", p2.get(p2.size() - 10), "mikasa");
        check("quoted franchise", p2.get(p2.size() - 11), "attack on titan");
        // quoted query with escaped ("") quotes inside
        String qq = "q5,\"tanjiro, \"\"fire\"\" peluche\",demon slayer,tanjiro,peluche,45,12.00,12.00,EUR,50,45,2,ok";
        List<String> p3 = splitCsvLine(qq);
        check("esc cols", p3.size(), 13);
        check("esc query", p3.get(1), "tanjiro, \"fire\" peluche");
        // empty-sold row (status=empty from real data)
        String es = "q4,frieza figurine,dragon ball,frieza,figurine,0,,,EUR,12,0,1,empty";
        List<String> p4 = splitCsvLine(es);
        check("empty sold", p4.get(p4.size() - 8), "0");
        check("empty median", p4.get(p4.size() - 7), "");
        System.out.println(fails == 0 ? "ALL CSV TESTS PASSED" : fails + " CSV TESTS FAILED");
        System.exit(fails == 0 ? 0 : 1);
    }
}
