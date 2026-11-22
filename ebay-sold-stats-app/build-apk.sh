#!/usr/bin/env bash
set -e
SDK=/workspace/android-tools/sdk
BT=$SDK/build-tools/34.0.0
PLATFORM=$SDK/platforms/android-34/android.jar
JDK=$(ls -d /workspace/android-tools/jdk-17*)
export JAVA_HOME=$JDK
export PATH=$JAVA_HOME/bin:$PATH
SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
ROOT=$SCRIPT_DIR
APP=$SCRIPT_DIR/App
BUILD=$SCRIPT_DIR/build
rm -rf "$BUILD"
mkdir -p "$BUILD/gen" "$BUILD/classes" "$BUILD/dex"

echo "== aapt2 compile =="
$BT/aapt2 compile --dir $APP/res -o $BUILD/res.zip

echo "== aapt2 link =="
$BT/aapt2 link -o $BUILD/base.apk \
  -A $APP/assets \
  -I "$PLATFORM" \
  $BUILD/res.zip \
  --manifest $APP/AndroidManifest.xml \
  --java $BUILD/gen \
  --min-sdk-version 21 --target-sdk-version 34 \
  --version-code 13 --version-name 2.4 \
  --auto-add-overlay

echo "== javac =="
find $BUILD/gen $APP/java -name "*.java" > $BUILD/sources.txt
javac --release 8 -classpath "$PLATFORM" -d $BUILD/classes @$BUILD/sources.txt 2> >(grep -v "warning" >&2) || { echo "JAVAC FAILED"; exit 1; }
ls $BUILD/classes/com/vibe/ebaysoldstats/

echo "== d8 =="
$BT/d8 --release --lib "$PLATFORM" --min-api 21 \
  $(find $BUILD/classes -name "*.class") \
  --output $BUILD/dex

echo "== package =="
cd $BUILD
cp base.apk unsigned.apk
zip -qj unsigned.apk dex/classes.dex

echo "== zipalign =="
$BT/zipalign -f 4 unsigned.apk aligned.apk

echo "== sign =="
if [ ! -f /workspace/ebay-app/debug.keystore ]; then
  keytool -genkeypair -keystore /workspace/ebay-app/debug.keystore -storepass android \
    -alias androiddebugkey -keypass android -keyalg RSA -keysize 2048 \
    -validity 10000 -dname "CN=Android Debug,O=Android,C=US" >/dev/null 2>&1
fi
$BT/apksigner sign --ks /workspace/ebay-app/debug.keystore --ks-pass pass:android \
  --key-pass pass:android --out $SCRIPT_DIR/ebay-sold-stats.apk aligned.apk
$BT/apksigner verify --print-certs $ROOT/ebay-sold-stats.apk
ls -la $SCRIPT_DIR/ebay-sold-stats.apk
echo "APK BUILT: $SCRIPT_DIR/ebay-sold-stats.apk"
