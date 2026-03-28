export async function uploadToPinata(file: File): Promise<string> {
    const formData = new FormData();
    formData.append("file", file);

    const res = await fetch("https://api.pinata.cloud/pinning/pinFileToIPFS", {
        method: "POST",
        headers: {
            Authorization: `Bearer ${process.env.NEXT_PUBLIC_PINATA_JWT}`, 
        },
        body: formData,
    });

    if (!res.ok) {
        throw new Error("Failed to upload to IPFS via Pinata");
    }

    const data = await res.json();
    return data.IpfsHash;
}