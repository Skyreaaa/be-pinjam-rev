import { v2 as cloudinary } from "cloudinary";
import multer from "multer";
import nc from "next-connect";

cloudinary.config({
  cloud_name: process.env.CLOUD_NAME,
  api_key: process.env.API_KEY,
  api_secret: process.env.API_SECRET,
});

const upload = multer({ storage: multer.memoryStorage() });

const handler = nc()
  .use(upload.single("coverImage"))
  .post(async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No file uploaded" });
      }

      const fileBase64 = req.file.buffer.toString("base64");

      const result = await cloudinary.uploader.upload(
        `data:${req.file.mimetype};base64,${fileBase64}`,
        {
          folder: "library_books"
        }
      );

      return res.json({
        success: true,
        url: result.secure_url
      });

    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  });

export const config = {
  api: {
    bodyParser: false,
  },
};

export default handler;
