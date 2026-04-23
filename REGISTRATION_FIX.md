# Land Registration Fix - IPFS Geometry Issue

## ❌ What Went Wrong

Your land registration was storing the **document file (JPEG image)** as the geometry CID instead of a **GeoJSON file containing the polygon coordinates**.

When you tried to calculate carbon credits, the system tried to fetch polynomial coordinates from an image file, which caused:

```
Failed to fetch geometry from IPFS: IPFS data is not valid JSON. 
Content-Type: image/jpeg. Make sure the IPFS CID points to a GeoJSON file.
```

## ✅ What's Fixed

The registration system now:

1. **Converts your polygon** drawing to GeoJSON format automatically
2. **Uploads GeoJSON separately** to IPFS (this becomes the geometry CID)
3. **Uploads your document** separately to IPFS (this becomes the document CID)
4. **Stores both CIDs** on the blockchain for proper carbon calculations

## 📋 What You Need to Do

### Option 1: Re-register Your Land (Recommended)

1. Go to **Dashboard** → Find your existing land
2. Note down the area (in hectares) - you'll need this
3. Go to **Register** page (top navigation)
4. **Draw the same polygon** on the map around your land
5. **Upload the same document** (PDF or JPG) you uploaded before
6. Click **"Register Land"**
7. Approve the wallet transaction

The new land record will have:
- ✅ Correct geometry CID (GeoJSON with polygon coordinates)
- ✅ Correct document CID (your proof document)

### Option 2: Try Calculating Credits (May Still Fail)

If you want to try using your existing registration first:

1. The geometry CID points to an image file
2. This will fail because Earth Engine needs polygon coordinates
3. You'll need to re-register anyway

## 🔧 Technical Details

### What Changed in Registration

**Before (❌ Incorrect):**
```
User draws polygon
    ↓
Uploads document to IPFS
    ↓
Uses document CID as both geometry AND document
    ↓
Result: Polygon data stored as image/jpeg (WRONG!)
```

**After (✅ Correct):**
```
User draws polygon
    ↓
Converts polygon to GeoJSON format
    ↓
Uploads GeoJSON to IPFS (geometry CID)
    ↓
Uploads document to IPFS (document CID)
    ↓
Stores both CIDs on blockchain
    ↓
Result: Geometry stored as valid GeoJSON (CORRECT!)
```

### GeoJSON Format Example

Your polygon coordinates are automatically converted to:

```json
{
  "type": "Polygon",
  "coordinates": [
    [
      [longitude, latitude],
      [longitude, latitude],
      ...
    ]
  ]
}
```

This is what the carbon calculation system expects to find at the geometry CID.

## 🚀 Re-registration Steps (Detailed)

### Step 1: Prepare Your Information

- ✅ Land area (hectares) - you'll draw to measure this
- ✅ Land document (PDF/JPG) - same proof document
- ✅ Wallet connected and funded (~0.05 SOL for fees)

### Step 2: Navigate to Register Page

1. Go to http://localhost:3000
2. Click **"Register"** in the navigation
3. Connect your wallet if needed

### Step 3: Draw the Polygon

1. On the map, draw a polygon around your land
2. Click multiple points to outline your land
3. Double-click to finish the polygon
4. The area will auto-calculate in hectares

### Step 4: Upload Document

1. Click **"Click to upload or drag and drop"**
2. Select your land proof document (PDF/JPG/PNG)
3. Verify it shows in the green box below

### Step 5: Submit

1. Click **"🌍 Register Land"** button
2. Approve the transaction in your wallet
3. Wait for confirmation (about 20-30 seconds)

### Step 6: Success Message

When successful, you'll see:

```
🎉 Land registered successfully!
✅ Geometry CID: Qm... (contains your polygon)
✅ Document CID: Qm... (contains your proof)
✅ Transaction: xxxx...
```

### Step 7: Calculate Credits

1. Go to **Dashboard**
2. Find your newly registered land
3. Wait for **Authority verification**
4. Once verified, click **"📊 Calculate Credits"**
5. Carbon analysis results will show in 30-60 seconds

## ⚠️ Important Notes

- **Old registration won't work** for carbon calculations (geometry is wrong format)
- **You must re-register** to fix the geometry CID
- **Registration is free** except for network fees (~0.05 SOL)
- **Your wallet must have SOL** for transaction fees
- **Document and geometry are separate** - don't mix them up

## ✅ Verification

After re-registration, verify the fix worked:

1. Go to Dashboard
2. Find your land
3. Click **"View Details"** to expand
4. Click **"📊 Calculate Credits"**
5. If it shows carbon results (not the JPEG error), the fix worked! ✅

## 🆘 Troubleshooting

### Error: "Account already in use"

**Cause:** Your old registration still exists with this landId

**Solution:** 
1. Draw a slightly different polygon (adjust boundaries slightly)
2. This will generate a different landId
3. The system will let you register the new one

### Error: "Land must be verified first"

**Cause:** The Authority hasn't approved your registration yet

**Solution:**
1. Wait for Authority to review
2. Go to Authority dashboard to manually approve your land
3. Then you can calculate credits

### Error: Still getting JPEG error

**Cause:** You're using your old land record

**Solution:**
1. Contact support or try a new registration
2. Make sure you're clicking the button on the newly registered land (should show different CID)

## 📞 Support

If you need help:

1. Check the error message carefully
2. Verify your wallet has SOL for fees
3. Try drawing the polygon again (slightly different area)
4. Contact support with your Transaction ID (txHash)

---

**Status:** ✅ Registration system fixed and ready for new registrations!

Your carbon pipeline is ready once you re-register your land with the corrected geometry handling.
