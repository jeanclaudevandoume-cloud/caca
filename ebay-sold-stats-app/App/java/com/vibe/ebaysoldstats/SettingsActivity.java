package com.vibe.ebaysoldstats;

import android.app.Activity;
import android.content.SharedPreferences;
import android.os.Bundle;
import android.widget.Button;
import android.widget.EditText;
import android.widget.Toast;

public class SettingsActivity extends Activity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_settings);

        final SharedPreferences prefs = getSharedPreferences("settings", MODE_PRIVATE);
        final EditText email = findViewById(R.id.input_email);
        final EditText password = findViewById(R.id.input_password);
        final EditText pages = findViewById(R.id.input_pages);
        final EditText cookies = findViewById(R.id.input_cookies);

        email.setText(prefs.getString("email", ""));
        password.setText(prefs.getString("password", ""));
        pages.setText(String.valueOf(prefs.getInt("pages", 3)));
        cookies.setText(prefs.getString("cookies_json", ""));

        Button save = findViewById(R.id.btn_save);
        save.setOnClickListener(v -> {
            int p = 3;
            try {
                p = Integer.parseInt(pages.getText().toString().trim());
            } catch (Exception ignored) { }
            if (p < 1) p = 1;
            if (p > 4) p = 4;
            prefs.edit()
                    .putString("email", email.getText().toString().trim())
                    .putString("password", password.getText().toString())
                    .putInt("pages", p)
                    .putString("cookies_json", cookies.getText().toString())
                    .apply();
            Toast.makeText(this, "Saved", Toast.LENGTH_SHORT).show();
            finish();
        });
    }
}
