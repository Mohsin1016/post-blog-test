const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const User = require('./models/User');
const Post = require('./models/Post');
const bcrypt = require('bcryptjs');
const dotenv = require('dotenv');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const multer = require('multer');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');

dotenv.config();
const app = express();
const upload = multer({ storage: multer.memoryStorage() });

const salt = bcrypt.genSaltSync(10);
const secret = process.env.JWT_SECRET;

const allowedOrigins = [
  'https://post-blog-test-x7xc.vercel.app',
  'https://test-blog-front.vercel.app',
  'http://localhost:3000'
];

app.use(cors({
  credentials: true,
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  }
}));
app.use(express.json());
app.use(cookieParser());

mongoose.connect(process.env.MONGO_URL)
  .then(() => console.log('MongoDB connected'))
  .catch((error) => console.error('MongoDB connection error:', error));

const s3Client = new S3Client({
  region: process.env.S3_REGION,
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
  },
});

async function uploadToS3(fileBuffer, fileName, mimeType) {
  const command = new PutObjectCommand({
    Bucket: process.env.S3_BUCKET_NAME,
    Key: fileName,
    Body: fileBuffer,
    ContentType: mimeType,
  });
  const response = await s3Client.send(command);
  return `https://${process.env.S3_BUCKET_NAME}.s3.${process.env.S3_REGION}.amazonaws.com/${fileName}`;
}

app.get('/', (req, res) => {
  res.json('test is running ok');
});

app.post('/register', async (req, res) => {
  const { username, password } = req.body;
  try {
    const userDoc = await User.create({
      username,
      password: bcrypt.hashSync(password, salt),
    });
    res.json(userDoc);
  } catch (e) {
    console.log(e);
    res.status(400).json(e);
  }
});

app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  try {
    const userDoc = await User.findOne({ username });
    if (!userDoc) {
      return res.status(400).json('wrong credentials');
    }
    const passOk = bcrypt.compareSync(password, userDoc.password);
    if (passOk) {
      jwt.sign({ username, id: userDoc._id }, secret, {}, (err, token) => {
        if (err) {
          console.error('JWT sign error:', err);
          return res.status(500).json('Internal server error');
        }
        res.cookie('token', token, { httpOnly: true, sameSite: 'None', secure: true }).json({
          id: userDoc._id,
          username,
        });
      });
    } else {
      res.status(400).json('wrong credentials');
    }
  } catch (e) {
    console.error('Login error:', e);
    res.status(500).json('Internal server error');
  }
});

app.get('/profile', (req, res) => {
  const { token } = req.cookies;
  console.log('Token:', token);
  if (!token) {
    return res.status(401).json('No token provided');
  }
  jwt.verify(token, secret, (err, info) => {
    if (err) {
      console.error('JWT verify error:', err);
      return res.status(401).json('Invalid token');
    }
    res.json(info);
  });
});

app.post('/logout', (req, res) => {
  res.cookie('token', '').json('ok');
});

app.post('/post', upload.single('file'), async (req, res) => {
  const { originalname, buffer, mimetype } = req.file;
  const fileName = `${Date.now()}_${originalname}`;

  try {
    const fileUrl = await uploadToS3(buffer, fileName, mimetype);

    const { token } = req.cookies;
    if (!token) {
      return res.status(401).json('No token provided');
    }
    jwt.verify(token, secret, async (err, info) => {
      if (err) {
        console.error('JWT verify error:', err);
        return res.status(401).json('Invalid token');
      }
      const { title, summary, content } = req.body;
      try {
        const postDoc = await Post.create({
          title,
          summary,
          content,
          cover: fileUrl,
          author: info.id,
        });
        res.json(postDoc);
      } catch (e) {
        console.error('Post creation error:', e);
        res.status(500).json('Internal server error');
      }
    });
  } catch (error) {
    console.error('S3 upload error:', error);
    res.status(500).json('Internal server error');
  }
});

app.put('/post', upload.single('file'), async (req, res) => {
  let newFileUrl = null;
  if (req.file) {
    const { originalname, buffer, mimetype } = req.file;
    const fileName = `${Date.now()}_${originalname}`;

    try {
      newFileUrl = await uploadToS3(buffer, fileName, mimetype);
    } catch (error) {
      console.error('S3 upload error:', error);
      return res.status(500).json('Internal server error');
    }
  }

  const { token } = req.cookies;
  if (!token) {
    return res.status(401).json('No token provided');
  }
  jwt.verify(token, secret, async (err, info) => {
    if (err) {
      console.error('JWT verify error:', err);
      return res.status(401).json('Invalid token');
    }
    const { id, title, summary, content } = req.body;
    try {
      const postDoc = await Post.findById(id);
      const isAuthor = JSON.stringify(postDoc.author) === JSON.stringify(info.id);
      if (!isAuthor) {
        return res.status(400).json('You are not the author');
      }

      postDoc.title = title;
      postDoc.summary = summary;
      postDoc.content = content;
      postDoc.cover = newFileUrl ? newFileUrl : postDoc.cover;

      await postDoc.save();

      res.json(postDoc);
    } catch (e) {
      console.error('Post update error:', e);
      res.status(500).json('Internal server error');
    }
  });
});

app.get('/post', async (req, res) => {
  try {
    const posts = await Post.find()
      .populate('author', ['username'])
      .sort({ createdAt: -1 })
      .limit(20);
    res.json(posts);
  } catch (e) {
    console.error('Fetching posts error:', e);
    res.status(500).json('Internal server error');
  }
});

app.get('/post/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const postDoc = await Post.findById(id).populate('author', ['username']);
    res.json(postDoc);
  } catch (e) {
    console.error('Fetching post error:', e);
    res.status(500).json('Internal server error');
  }
});

module.exports = app;
