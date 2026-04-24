require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { Op } = require('sequelize');
const { sequelize, User, Supply, Favorite } = require('./models');
const { v4: uuidv4 } = require('uuid');
const promClient = require('prom-client');

const app = express();
const PORT = process.env.PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET || 'lab-secret-key';

const register = promClient.register;
promClient.collectDefaultMetrics({ register });

const httpRequestDuration = new promClient.Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.1, 0.3, 0.5, 1, 2, 5],
});

app.use((req, res, next) => {
  const end = httpRequestDuration.startTimer({ method: req.method, route: req.path });
  res.on('finish', () => {
    end({ status_code: res.statusCode });
  });
  next();
});

app.use(cors());
app.use(bodyParser.json());

const generateToken = (user) => jwt.sign({ id: user.id, role: user.role }, JWT_SECRET, { expiresIn: '7d' });

const authenticateToken = (req, res, next) => {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ message: 'Authentication required' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(401).json({ message: 'Invalid authentication token' });
  }
};

const authorizeAdmin = (req, res, next) => {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ message: 'Admin access required' });
  }
  next();
};

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.get('/metrics', async (req, res) => {
  try {
    res.set('Content-Type', register.contentType);
    res.send(await register.metrics());
  } catch (error) {
    res.status(500).send(`Error collecting metrics: ${error.message}`);
  }
});

app.post('/api/auth/register', async (req, res) => {
  try {
    const { email, password, name } = req.body;
    const normalizedEmail = String(email || '').trim() || `guest-${Date.now()}@example.com`;
    const normalizedName = String(name || '').trim() || normalizedEmail.split('@')[0] || 'Guest';
    const normalizedPassword = String(password || '').trim() || `pass${Date.now()}`;

    let user = await User.findOne({ where: { email: normalizedEmail } });
    if (user) {
      const token = generateToken(user);
      return res.status(200).json({ user: { id: user.id, email: user.email, name: user.name, role: user.role, createdAt: user.createdAt }, token });
    }

    const passwordHash = await bcrypt.hash(normalizedPassword, 10);
    user = await User.create({
      id: `USR-${uuidv4()}`,
      name: normalizedName,
      email: normalizedEmail,
      passwordHash,
      role: 'user',
    });

    const token = generateToken(user);
    res.status(201).json({ user: { id: user.id, email: user.email, name: user.name, role: user.role, createdAt: user.createdAt }, token });
  } catch (error) {
    console.error('POST /api/auth/register error', error);
    res.status(500).json({ message: 'Server error creating user' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const normalizedEmail = String(email || '').trim();
    const normalizedPassword = String(password || '').trim();

    if (!normalizedEmail || !normalizedPassword) {
      return res.status(400).json({ message: 'Email and password are required' });
    }

    let user = await User.findOne({ where: { email: normalizedEmail } });
    if (!user) {
      const passwordHash = await bcrypt.hash(normalizedPassword, 10);
      user = await User.create({
        id: `USR-${uuidv4()}`,
        name: normalizedEmail.split('@')[0] || 'Guest',
        email: normalizedEmail,
        passwordHash,
        role: 'user',
      });
    } else {
      const validPassword = await bcrypt.compare(normalizedPassword, user.passwordHash);
      if (!validPassword) {
        return res.status(401).json({ message: 'Invalid credentials' });
      }
    }

    const token = generateToken(user);
    res.json({ user: { id: user.id, email: user.email, name: user.name, role: user.role, createdAt: user.createdAt }, token });
  } catch (error) {
    console.error('POST /api/auth/login error', error);
    res.status(500).json({ message: 'Server error logging in' });
  }
});

app.post('/api/admin/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const normalizedEmail = String(email || '').trim();
    const normalizedPassword = String(password || '').trim();

    if (!normalizedEmail || !normalizedPassword) {
      return res.status(400).json({ message: 'Email and password are required' });
    }

    const user = await User.findOne({ where: { email: normalizedEmail } });
    if (!user) {
      return res.status(401).json({ message: 'Invalid admin credentials' });
    }

    if (user.role !== 'admin') {
      return res.status(403).json({ message: 'Only admin users can log in here' });
    }

    const validPassword = await bcrypt.compare(normalizedPassword, user.passwordHash);
    if (!validPassword) {
      return res.status(401).json({ message: 'Invalid admin credentials' });
    }

    const token = generateToken(user);
    res.json({ user: { id: user.id, email: user.email, name: user.name, role: user.role, createdAt: user.createdAt }, token });
  } catch (error) {
    console.error('POST /api/admin/login error', error);
    res.status(500).json({ message: 'Server error logging in admin' });
  }
});

app.get('/api/auth/me', authenticateToken, async (req, res) => {
  try {
    const user = await User.findByPk(req.user.id);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    res.json({ user: { id: user.id, email: user.email, name: user.name, role: user.role, createdAt: user.createdAt } });
  } catch (error) {
    console.error('GET /api/auth/me error', error);
    res.status(500).json({ message: 'Server error fetching user' });
  }
});

app.post('/api/auth/reset', async (req, res) => {
  try {
    const { email } = req.body;
    const user = await User.findOne({ where: { email } });
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const tempPassword = 'TempPass123!';
    user.passwordHash = await bcrypt.hash(tempPassword, 10);
    await user.save();

    res.json({ message: `Temporary password set: ${tempPassword}` });
  } catch (error) {
    console.error('POST /api/auth/reset error', error);
    res.status(500).json({ message: 'Server error resetting password' });
  }
});

app.get('/api/supplies', async (req, res) => {
  try {
    const search = String(req.query.search || '').trim();
    const category = String(req.query.category || 'All');
    const sortBy = String(req.query.sortBy || 'name');
    const order = String(req.query.order || 'asc').toLowerCase() === 'desc' ? 'desc' : 'asc';
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.max(4, Math.min(100, parseInt(req.query.limit, 10) || 12));
    const priceMin = Number(req.query.priceMin || 0);
    const priceMax = Number(req.query.priceMax || 9999999);
    const inStock = req.query.inStock === 'true' ? true : req.query.inStock === 'false' ? false : null;

    const where = {};
    const searchOp = sequelize.getDialect() === 'postgres' ? Op.iLike : Op.like;
    if (search) {
      where[Op.or] = [
        { name: { [searchOp]: `%${search}%` } },
        { description: { [searchOp]: `%${search}%` } },
        { brand: { [searchOp]: `%${search}%` } },
      ];
    }

    if (category && category !== 'All') {
      where.category = category;
    }

    where.price = { [Op.gte]: priceMin, [Op.lte]: priceMax };

    if (inStock !== null) {
      where.inStock = inStock;
    }

    const { count, rows } = await Supply.findAndCountAll({
      where,
      order: [[sortBy, order]],
      offset: (page - 1) * limit,
      limit,
    });

    res.json({ total: count, page, limit, supplies: rows });
  } catch (error) {
    console.error('GET /api/supplies error', error);
    res.status(500).json({ message: 'Server error fetching supplies' });
  }
});

app.post('/api/supplies', authenticateToken, authorizeAdmin, async (req, res) => {
  try {
    const {
      name,
      category,
      description,
      price,
      availability,
      brand,
      imageUrl,
      externalLink,
      inStock,
      rating,
      quantity,
      location,
    } = req.body;

    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ message: 'Supply name is required' });
    }

    const newSupply = await Supply.create({
      id: `SUP-${uuidv4()}`,
      name: name.trim(),
      category: category || 'Equipment',
      description: description || '',
      price: Number(price) || 0,
      availability: availability || 'In Stock',
      brand: brand || '',
      imageUrl: imageUrl || '',
      externalLink: externalLink || '',
      inStock: Boolean(inStock),
      rating: Number.isFinite(Number(rating)) ? Number(rating) : 4,
      quantity: Number(quantity) || 0,
      location: location || '',
      createdBy: req.user.id,
    });

    res.status(201).json(newSupply);
  } catch (error) {
    console.error('POST /api/supplies error', error);
    res.status(500).json({ message: 'Server error creating supply' });
  }
});

app.put('/api/supplies/:id', authenticateToken, authorizeAdmin, async (req, res) => {
  try {
    const supply = await Supply.findByPk(req.params.id);
    if (!supply) {
      return res.status(404).json({ message: 'Supply not found' });
    }

    const {
      name,
      category,
      description,
      price,
      availability,
      brand,
      imageUrl,
      externalLink,
      inStock,
      rating,
      quantity,
      location,
    } = req.body;

    await supply.update({
      name: name?.trim() || supply.name,
      category: category || supply.category,
      description: description ?? supply.description,
      price: Number(price) || supply.price,
      availability: availability || supply.availability,
      brand: brand ?? supply.brand,
      imageUrl: imageUrl ?? supply.imageUrl,
      externalLink: externalLink ?? supply.externalLink,
      inStock: typeof inStock === 'boolean' ? inStock : supply.inStock,
      rating: Number.isFinite(Number(rating)) ? Number(rating) : supply.rating,
      quantity: Number.isFinite(Number(quantity)) ? Number(quantity) : supply.quantity,
      location: location ?? supply.location,
    });

    res.json(supply);
  } catch (error) {
    console.error('PUT /api/supplies error', error);
    res.status(500).json({ message: 'Server error updating supply' });
  }
});

app.delete('/api/supplies/:id', authenticateToken, authorizeAdmin, async (req, res) => {
  try {
    const supply = await Supply.findByPk(req.params.id);
    if (!supply) {
      return res.status(404).json({ message: 'Supply not found' });
    }

    await supply.destroy();
    res.json({ message: 'Deleted' });
  } catch (error) {
    console.error('DELETE /api/supplies error', error);
    res.status(500).json({ message: 'Server error deleting supply' });
  }
});

app.get('/api/admin/summary', authenticateToken, authorizeAdmin, async (req, res) => {
  try {
    const productsCount = await Supply.count();
    const usersCount = await User.count();
    const favoritesCount = await Favorite.count();
    res.json({ productsCount, usersCount, favoritesCount });
  } catch (error) {
    console.error('GET /api/admin/summary error', error);
    res.status(500).json({ message: 'Server error fetching summary' });
  }
});

app.get('/api/admin/users', authenticateToken, authorizeAdmin, async (req, res) => {
  try {
    const users = await User.findAll({
      attributes: ['id', 'name', 'email', 'role', 'createdAt'],
      order: [['createdAt', 'DESC']],
    });
    res.json({ users });
  } catch (error) {
    console.error('GET /api/admin/users error', error);
    res.status(500).json({ message: 'Server error fetching users' });
  }
});

app.get('/api/users/me/favorites', authenticateToken, async (req, res) => {
  try {
    const user = await User.findByPk(req.user.id, {
      include: [{ model: Supply, as: 'favoriteSupplies' }],
    });
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    res.json({ favorites: user.favoriteSupplies });
  } catch (error) {
    console.error('GET /api/users/me/favorites error', error);
    res.status(500).json({ message: 'Server error fetching favorites' });
  }
});

app.post('/api/users/me/favorites/:supplyId', authenticateToken, async (req, res) => {
  try {
    const supply = await Supply.findByPk(req.params.supplyId);
    if (!supply) {
      return res.status(404).json({ message: 'Supply not found' });
    }

    const [favorite] = await Favorite.findOrCreate({
      where: { userId: req.user.id, supplyId: supply.id },
      defaults: { userId: req.user.id, supplyId: supply.id },
    });

    res.status(201).json({ favorite });
  } catch (error) {
    console.error('POST /api/users/me/favorites error', error);
    res.status(500).json({ message: 'Server error saving favorite' });
  }
});

app.delete('/api/users/me/favorites/:supplyId', authenticateToken, async (req, res) => {
  try {
    const deleted = await Favorite.destroy({ where: { userId: req.user.id, supplyId: req.params.supplyId } });
    if (!deleted) {
      return res.status(404).json({ message: 'Favorite not found' });
    }
    res.json({ message: 'Favorite removed' });
  } catch (error) {
    console.error('DELETE /api/users/me/favorites error', error);
    res.status(500).json({ message: 'Server error deleting favorite' });
  }
});

app.use((err, req, res, next) => {
  console.error('Unhandled error', err);
  res.status(500).json({ message: 'Internal server error' });
});

const startServer = async () => {
  await sequelize.sync({ alter: true });

  let adminExists = await User.findOne({ where: { email: 'admin@gmail.com' } });
  const adminRawPassword = '123456';
  const adminPasswordHash = await bcrypt.hash(adminRawPassword, 10);

  if (!adminExists) {
    await User.create({
      id: 'admin-001',
      name: 'Administrator',
      email: 'admin@gmail.com',
      passwordHash: adminPasswordHash,
      role: 'admin',
    });
  } else {
    let changed = false;
    if (adminExists.role !== 'admin') {
      adminExists.role = 'admin';
      changed = true;
    }

    const passwordMatches = await bcrypt.compare(adminRawPassword, adminExists.passwordHash);
    if (!passwordMatches) {
      adminExists.passwordHash = adminPasswordHash;
      changed = true;
    }

    if (changed) {
      await adminExists.save();
    }
  }

  const count = await Supply.count();
  if (count === 0) {
    const sampleSupplies = [
      {
        id: 'EQ001',
        name: 'Centrifuge ST 16',
        category: 'Equipment',
        description: 'High-speed centrifuge for microtubes and 15 mL tubes with digital display.',
        price: 12900,
        availability: 'In Stock',
        brand: 'Thermo Fisher',
        imageUrl: 'https://via.placeholder.com/420x280.png?text=Centrifuge+ST+16',
        externalLink: 'https://www.thermofisher.com/order/catalog/product/SA400090',
        inStock: true,
        rating: 5,
        quantity: 5,
        location: 'Lab A',
      },
      {
        id: 'RG001',
        name: 'Ethanol Absolute, 99.5%',
        category: 'Reagent',
        description: 'High purity ethanol for laboratory use, 1L bottle.',
        price: 48,
        availability: 'In Stock',
        brand: 'Sigma-Aldrich',
        imageUrl: 'https://via.placeholder.com/420x280.png?text=Ethanol+99.5%25',
        externalLink: 'https://www.sigmaaldrich.com/US/en/product/sial/221005',
        inStock: true,
        rating: 4,
        quantity: 20,
        location: 'Lab B',
      },
      {
        id: 'CO001',
        name: '96-Well PCR Plate',
        category: 'Consumable',
        description: 'Sterile flat-bottom plate, pack of 10.',
        price: 59,
        availability: 'In Stock',
        brand: 'VWR',
        imageUrl: 'https://via.placeholder.com/420x280.png?text=96-Well+PCR+Plate',
        externalLink: 'https://www.vwr.com/store/product/75870-150',
        inStock: true,
        rating: 4,
        quantity: 35,
        location: 'Lab C',
      },
    ];
    await Supply.bulkCreate(sampleSupplies);
    console.log('Seeded supplies in DB');
  }

  app.listen(PORT, () => {
    console.log(`Backend running at http://localhost:${PORT}`);
  });
};

if (require.main === module) {
  startServer();
}

module.exports = { app, startServer, sequelize };
