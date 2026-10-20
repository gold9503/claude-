package kr.wisequotes.app;

import android.app.Activity;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.media.MediaPlayer;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowManager;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Random;

/** 실행할 때마다 명언을 무작위로 보여주고, 배경에 클래식 음악을 이어서 틀어주는 화면. */
public class MainActivity extends Activity {
    private static final long AUTO_NEXT_MS = 30_000;
    private static final float MUSIC_VOLUME = 0.6f;

    private static final int[] TRACKS = {R.raw.bach_prelude, R.raw.pachelbel_canon, R.raw.fur_elise};
    private static final String[] TRACK_TITLES = {
            "J.S. 바흐 · 평균율 프렐류드 C장조",
            "J. 파헬벨 · 캐논 D장조",
            "L.v. 베토벤 · 엘리제를 위하여",
    };

    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Random random = new Random();
    private final List<String[]> quotes = new ArrayList<>();
    private final List<Integer> deck = new ArrayList<>();

    private TextView quoteView;
    private TextView authorView;
    private TextView musicButton;
    private TextView nowPlaying;
    private LinearLayout card;

    private SharedPreferences prefs;
    private MediaPlayer player;
    private int track;
    private boolean musicOn;

    private final Runnable autoNext = new Runnable() {
        @Override
        public void run() {
            showNextQuote();
        }
    };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        prefs = getSharedPreferences("settings", MODE_PRIVATE);
        musicOn = prefs.getBoolean("music", true);
        track = random.nextInt(TRACKS.length);

        loadQuotes();
        setContentView(buildLayout());
        showNextQuote();
    }

    private View buildLayout() {
        FrameLayout root = new FrameLayout(this);
        GradientDrawable bg = new GradientDrawable(GradientDrawable.Orientation.TL_BR,
                new int[]{0xFF1B1F3B, 0xFF3A2E5C, 0xFF6B4E71});
        root.setBackground(bg);

        // 가운데 명언 카드
        card = new LinearLayout(this);
        card.setOrientation(LinearLayout.VERTICAL);
        card.setGravity(Gravity.CENTER);
        card.setPadding(dp(32), dp(32), dp(32), dp(32));
        card.setAlpha(0f);

        TextView mark = text("“", 72, 0x66F5D98B);
        mark.setTypeface(Typeface.SERIF, Typeface.BOLD);
        card.addView(mark);

        quoteView = text("", 24, Color.WHITE);
        quoteView.setTypeface(Typeface.SERIF);
        quoteView.setLineSpacing(dp(6), 1f);
        card.addView(quoteView);

        authorView = text("", 16, 0xFFF5D98B);
        authorView.setPadding(0, dp(24), 0, 0);
        card.addView(authorView);

        root.addView(card, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.WRAP_CONTENT, Gravity.CENTER));

        // 상단 안내
        TextView hint = text("화면을 누르면 다른 명언 · 길게 누르면 복사", 13, 0x99FFFFFF);
        FrameLayout.LayoutParams hintLp = new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.WRAP_CONTENT, Gravity.TOP);
        hintLp.topMargin = dp(20);
        root.addView(hint, hintLp);

        // 하단 음악 바
        LinearLayout bar = new LinearLayout(this);
        bar.setOrientation(LinearLayout.VERTICAL);
        bar.setGravity(Gravity.CENTER_HORIZONTAL);

        nowPlaying = text("", 13, 0xCCFFFFFF);
        nowPlaying.setPadding(dp(16), dp(8), dp(16), dp(8));
        nowPlaying.setOnClickListener(v -> nextTrack());
        bar.addView(nowPlaying);

        musicButton = text("", 15, Color.WHITE);
        musicButton.setPadding(dp(24), dp(10), dp(24), dp(10));
        GradientDrawable pill = new GradientDrawable();
        pill.setCornerRadius(dp(24));
        pill.setColor(0x33FFFFFF);
        musicButton.setBackground(pill);
        musicButton.setOnClickListener(v -> toggleMusic());
        bar.addView(musicButton);

        FrameLayout.LayoutParams barLp = new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.WRAP_CONTENT, Gravity.BOTTOM);
        barLp.bottomMargin = dp(28);
        root.addView(bar, barLp);

        root.setOnClickListener(v -> showNextQuote());
        root.setOnLongClickListener(v -> {
            copyQuote();
            return true;
        });

        // Android 15부터는 화면이 상태바/내비게이션바 아래까지 그려지므로 그만큼 여백을 둠
        root.setOnApplyWindowInsetsListener((v, insets) -> {
            int top;
            int bottom;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                android.graphics.Insets bars = insets.getInsets(WindowInsets.Type.systemBars());
                top = bars.top;
                bottom = bars.bottom;
            } else {
                top = insets.getSystemWindowInsetTop();
                bottom = insets.getSystemWindowInsetBottom();
            }
            v.setPadding(0, top, 0, bottom);
            return insets;
        });

        updateMusicUi();
        return root;
    }

    private TextView text(String s, int sp, int color) {
        TextView tv = new TextView(this);
        tv.setText(s);
        tv.setTextSize(TypedValue.COMPLEX_UNIT_SP, sp);
        tv.setTextColor(color);
        tv.setGravity(Gravity.CENTER);
        return tv;
    }

    private int dp(int v) {
        return Math.round(v * getResources().getDisplayMetrics().density);
    }

    private void loadQuotes() {
        try (BufferedReader r = new BufferedReader(
                new InputStreamReader(getAssets().open("quotes.txt"), StandardCharsets.UTF_8))) {
            String line;
            while ((line = r.readLine()) != null) {
                line = line.trim();
                if (line.isEmpty() || line.startsWith("#")) continue;
                int bar = line.lastIndexOf('|');
                if (bar < 0) {
                    quotes.add(new String[]{line, ""});
                } else {
                    quotes.add(new String[]{line.substring(0, bar).trim(), line.substring(bar + 1).trim()});
                }
            }
        } catch (IOException e) {
            quotes.add(new String[]{"인내는 쓰다. 그러나 그 열매는 달다.", "장 자크 루소"});
        }
    }

    /** 섞어둔 순서대로 꺼내서 모든 명언이 한 번씩 나오기 전에는 같은 명언이 반복되지 않게 함. */
    private String[] drawQuote() {
        if (deck.isEmpty()) {
            for (int i = 0; i < quotes.size(); i++) deck.add(i);
            Collections.shuffle(deck, random);
        }
        return quotes.get(deck.remove(deck.size() - 1));
    }

    private void showNextQuote() {
        handler.removeCallbacks(autoNext);
        final String[] q = drawQuote();
        card.animate().cancel();
        card.animate().alpha(0f).setDuration(350).withEndAction(() -> {
            quoteView.setText(q[0]);
            authorView.setText(q[1].isEmpty() ? "" : "— " + q[1]);
            card.setTranslationY(dp(12));
            card.animate().alpha(1f).translationY(0).setDuration(900).start();
        }).start();
        handler.postDelayed(autoNext, AUTO_NEXT_MS);
    }

    private void copyQuote() {
        String s = quoteView.getText() + "\n" + authorView.getText();
        ClipboardManager cm = (ClipboardManager) getSystemService(CLIPBOARD_SERVICE);
        cm.setPrimaryClip(ClipData.newPlainText("명언", s));
        Toast.makeText(this, "명언을 복사했어요", Toast.LENGTH_SHORT).show();
    }

    // ---- 음악 ----

    private void startMusic() {
        if (player == null) {
            player = MediaPlayer.create(this, TRACKS[track]);
            if (player == null) return;
            player.setVolume(MUSIC_VOLUME, MUSIC_VOLUME);
            player.setOnCompletionListener(mp -> nextTrack());
        }
        player.start();
        updateMusicUi();
    }

    private void releasePlayer() {
        if (player != null) {
            player.release();
            player = null;
        }
    }

    private void nextTrack() {
        track = (track + 1) % TRACKS.length;
        releasePlayer();
        if (musicOn) startMusic();
        updateMusicUi();
    }

    private void toggleMusic() {
        musicOn = !musicOn;
        prefs.edit().putBoolean("music", musicOn).apply();
        if (musicOn) {
            startMusic();
        } else if (player != null) {
            player.pause();
        }
        updateMusicUi();
    }

    private void updateMusicUi() {
        if (musicButton == null) return;
        musicButton.setText(musicOn ? "♪ 음악 끄기" : "♪ 음악 켜기");
        nowPlaying.setText(musicOn ? "지금 흐르는 곡: " + TRACK_TITLES[track] + "  ▸" : "음악이 꺼져 있어요");
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (musicOn) startMusic();
    }

    @Override
    protected void onPause() {
        super.onPause();
        if (player != null && player.isPlaying()) player.pause();
    }

    @Override
    protected void onDestroy() {
        handler.removeCallbacks(autoNext);
        releasePlayer();
        super.onDestroy();
    }
}
