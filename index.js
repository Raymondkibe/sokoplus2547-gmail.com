// ============================================
// SOKOPLUS BACKEND API - Complete Implementation
// ============================================

const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

const app = express();

// Middleware
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Initialize Supabase
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, supabaseAnonKey);
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

// JWT Configuration
const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

// Payment Configuration
const SUB_AMOUNT = parseFloat(process.env.SUB_AMOUNT) || 50;
const UPGRADE_AMOUNT = parseFloat(process.env.UPGRADE_AMOUNT) || 200;
const REFERRAL_SUB_COMMISSION = parseFloat(process.env.REFERRAL_SUB_COMMISSION) || 25;
const REFERRAL_UPGRADE_COMMISSION = parseFloat(process.env.REFERRAL_UPGRADE_COMMISSION) || 100;
const WITHDRAWAL_FEE_PERCENT = parseFloat(process.env.WITHDRAWAL_FEE_PERCENT) || 10;

// Authentication Middleware
const authenticateToken = async (req, res, next) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    
    if (!token) {
      return res.status(401).json({ 
        success: false, 
        message: 'Access token required' 
      });
    }
    
    const decoded = jwt.verify(token, JWT_SECRET);
    
    const { data: user, error } = await supabaseAdmin
      .from('users')
      .select('*')
      .eq('id', decoded.userId)
      .single();
    
    if (error || !user) {
      return res.status(401).json({ 
        success: false, 
        message: 'User not found' 
      });
    }
    
    if (user.status !== 'active') {
      return res.status(403).json({ 
        success: false, 
        message: 'Account is suspended' 
      });
    }
    
    req.user = user;
    next();
  } catch (error) {
    return res.status(403).json({ 
      success: false, 
      message: 'Invalid or expired token' 
    });
  }
};

// Admin Middleware
const isAdmin = (req, res, next) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ 
      success: false, 
      message: 'Admin access required' 
    });
  }
  next();
};

// File Upload Configuration
const storage = multer.memoryStorage();
const upload = multer({ 
  storage: storage,
  limits: { 
    fileSize: 10 * 1024 * 1024, // 10MB
    files: 10
  }
});

// ============================================
// DATABASE INITIALIZATION
// ============================================

async function initializeDatabase() {
  console.log('🚀 Initializing SOKOPLUS Database...');
  
  try {
    // Create users table
    const usersTable = `
      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(100) NOT NULL,
        email VARCHAR(255) UNIQUE NOT NULL,
        phone VARCHAR(20) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        profile_picture TEXT,
        location VARCHAR(100),
        bio TEXT,
        business_name VARCHAR(100),
        referral_code VARCHAR(20) UNIQUE NOT NULL,
        referral_from VARCHAR(20),
        subscription_active BOOLEAN DEFAULT false,
        subscription_type VARCHAR(20) DEFAULT 'weekly',
        subscription_expires_at TIMESTAMPTZ,
        upgraded BOOLEAN DEFAULT false,
        upgraded_at TIMESTAMPTZ,
        earnings_balance DECIMAL(10,2) DEFAULT 0,
        earnings_total DECIMAL(10,2) DEFAULT 0,
        earnings_withdrawn DECIMAL(10,2) DEFAULT 0,
        role VARCHAR(20) DEFAULT 'user',
        verified BOOLEAN DEFAULT false,
        status VARCHAR(20) DEFAULT 'active',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `;
    
    // Create posts table
    const postsTable = `
      CREATE TABLE IF NOT EXISTS posts (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        type VARCHAR(20) NOT NULL CHECK (type IN ('product', 'social', 'job', 'service', 'cv')),
        title VARCHAR(255),
        content TEXT,
        description TEXT,
        price DECIMAL(10,2),
        price_min DECIMAL(10,2),
        price_max DECIMAL(10,2),
        salary_min DECIMAL(10,2),
        salary_max DECIMAL(10,2),
        category VARCHAR(50),
        location VARCHAR(100),
        whatsapp VARCHAR(20) NOT NULL,
        company VARCHAR(100),
        job_type VARCHAR(20),
        apply_link VARCHAR(255),
        images TEXT[] DEFAULT '{}',
        boosted BOOLEAN DEFAULT false,
        boost_expires_at TIMESTAMPTZ,
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        views INTEGER DEFAULT 0,
        likes UUID[] DEFAULT '{}',
        status VARCHAR(20) DEFAULT 'active',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `;
    
    // Create payments table
    const paymentsTable = `
      CREATE TABLE IF NOT EXISTS payments (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        amount DECIMAL(10,2) NOT NULL,
        type VARCHAR(20) NOT NULL CHECK (type IN ('subscription', 'boost', 'upgrade')),
        transaction_code VARCHAR(100) UNIQUE NOT NULL,
        status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'failed')),
        post_id UUID REFERENCES posts(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `;
    
    // Create withdrawals table
    const withdrawalsTable = `
      CREATE TABLE IF NOT EXISTS withdrawals (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        amount DECIMAL(10,2) NOT NULL,
        fee DECIMAL(10,2) DEFAULT 0,
        net_amount DECIMAL(10,2) NOT NULL,
        mpesa_number VARCHAR(20) NOT NULL,
        status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'failed', 'processed')),
        approved_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `;
    
    // Create referrals table
    const referralsTable = `
      CREATE TABLE IF NOT EXISTS referrals (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        referrer_id UUID REFERENCES users(id) ON DELETE CASCADE,
        referred_user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        commission DECIMAL(10,2) NOT NULL,
        type VARCHAR(20) DEFAULT 'subscription' CHECK (type IN ('subscription', 'upgrade')),
        status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'paid')),
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(referrer_id, referred_user_id, type)
      );
    `;
    
    // Create shops table
    const shopsTable = `
      CREATE TABLE IF NOT EXISTS shops (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES users(id) ON DELETE CASCADE UNIQUE,
        name VARCHAR(100) NOT NULL,
        description TEXT,
        category VARCHAR(50),
        logo TEXT,
        banner TEXT,
        whatsapp VARCHAR(20) NOT NULL,
        location VARCHAR(100),
        business_hours VARCHAR(100),
        rating DECIMAL(3,2) DEFAULT 0,
        total_sales INTEGER DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `;
    
    // Create cvs table
    const cvsTable = `
      CREATE TABLE IF NOT EXISTS cvs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        title VARCHAR(255) NOT NULL,
        file_url TEXT NOT NULL,
        summary TEXT,
        skills TEXT[] DEFAULT '{}',
        experience VARCHAR(50),
        expected_salary DECIMAL(10,2),
        location VARCHAR(100),
        uploaded_at TIMESTAMPTZ DEFAULT NOW(),
        status VARCHAR(20) DEFAULT 'active'
      );
    `;
    
    // Create notifications table
    const notificationsTable = `
      CREATE TABLE IF NOT EXISTS notifications (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        title VARCHAR(255) NOT NULL,
        message TEXT NOT NULL,
        type VARCHAR(20) DEFAULT 'info',
        read BOOLEAN DEFAULT false,
        data JSONB,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `;
    
    // Execute all table creations
    await supabaseAdmin.rpc('exec_sql', { sql: usersTable });
    await supabaseAdmin.rpc('exec_sql', { sql: postsTable });
    await supabaseAdmin.rpc('exec_sql', { sql: paymentsTable });
    await supabaseAdmin.rpc('exec_sql', { sql: withdrawalsTable });
    await supabaseAdmin.rpc('exec_sql', { sql: referralsTable });
    await supabaseAdmin.rpc('exec_sql', { sql: shopsTable });
    await supabaseAdmin.rpc('exec_sql', { sql: cvsTable });
    await supabaseAdmin.rpc('exec_sql', { sql: notificationsTable });
    
    console.log('✅ Database initialization completed!');
    
    // Create admin user
    await createAdminUser();
    
  } catch (error) {
    console.error('❌ Database initialization error:', error.message);
  }
}

async function createAdminUser() {
  try {
    const adminEmail = process.env.ADMIN_EMAIL || 'admin@sokoplus.com';
    const adminPassword = process.env.ADMIN_PASSWORD || 'Admin@SokoPlus2024';
    
    const { data: existingAdmin } = await supabaseAdmin
      .from('users')
      .select('id')
      .eq('email', adminEmail)
      .single();
    
    if (!existingAdmin) {
      const salt = await bcrypt.genSalt(10);
      const passwordHash = await bcrypt.hash(adminPassword, salt);
      
      const adminUser = {
        id: uuidv4(),
        name: 'SOKOPLUS Admin',
        email: adminEmail,
        phone: '254712883849',
        password_hash: passwordHash,
        referral_code: generateReferralCode('ADMIN'),
        subscription_active: true,
        upgraded: true,
        role: 'admin',
        verified: true,
        created_at: new Date().toISOString()
      };
      
      await supabaseAdmin
        .from('users')
        .insert([adminUser]);
      
      console.log('👑 Admin user created successfully!');
      console.log('📧 Email:', adminEmail);
      console.log('🔑 Password:', adminPassword);
    }
  } catch (error) {
    console.log('⚠️ Admin user already exists or error:', error.message);
  }
}

// ============================================
// UTILITY FUNCTIONS
// ============================================

function generateReferralCode(name) {
  const random = Math.random().toString(36).substring(2, 8).toUpperCase();
  const initials = name.split(' ').map(n => n[0]).join('').toUpperCase();
  return (initials + random).substring(0, 8);
}

function formatPrice(price) {
  return 'KES ' + parseFloat(price || 0).toLocaleString('en-KE');
}

// ============================================
// AUTHENTICATION ENDPOINTS
// ============================================

// Register User
app.post('/api/auth/register', async (req, res) => {
  try {
    const { name, email, phone, password, referralCode } = req.body;
    
    if (!name || !email || !phone || !password) {
      return res.status(400).json({ 
        success: false, 
        message: 'All fields are required' 
      });
    }
    
    // Validate phone format
    if (!/^2547\d{8}$/.test(phone)) {
      return res.status(400).json({ 
        success: false, 
        message: 'Phone must be in format: 2547XXXXXXXX' 
      });
    }
    
    // Check existing user
    const { data: existingUser } = await supabaseAdmin
      .from('users')
      .select('id')
      .or(`email.eq.${email},phone.eq.${phone}`)
      .single();
    
    if (existingUser) {
      return res.status(400).json({ 
        success: false, 
        message: 'User with this email or phone already exists' 
      });
    }
    
    // Hash password
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);
    
    // Generate referral code
    const userReferralCode = generateReferralCode(name);
    
    // Create user
    const newUser = {
      id: uuidv4(),
      name,
      email,
      phone,
      password_hash: passwordHash,
      referral_code: userReferralCode,
      referral_from: referralCode || null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    
    const { error: userError } = await supabaseAdmin
      .from('users')
      .insert([newUser]);
    
    if (userError) throw userError;
    
    // Handle referral
    if (referralCode) {
      const { data: referrer } = await supabaseAdmin
        .from('users')
        .select('id')
        .eq('referral_code', referralCode)
        .single();
      
      if (referrer) {
        const referralData = {
          id: uuidv4(),
          referrer_id: referrer.id,
          referred_user_id: newUser.id,
          commission: REFERRAL_SUB_COMMISSION,
          type: 'subscription',
          status: 'pending',
          created_at: new Date().toISOString()
        };
        
        await supabaseAdmin
          .from('referrals')
          .insert([referralData]);
      }
    }
    
    // Generate token
    const token = jwt.sign(
      { userId: newUser.id, email: newUser.email, role: 'user' },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );
    
    // Remove sensitive data
    const { password_hash, ...userWithoutPassword } = newUser;
    
    res.status(201).json({
      success: true,
      message: 'Registration successful',
      user: userWithoutPassword,
      token
    });
    
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Registration failed', 
      error: error.message 
    });
  }
});

// Login User
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    if (!email || !password) {
      return res.status(400).json({ 
        success: false, 
        message: 'Email and password required' 
      });
    }
    
    const { data: user, error } = await supabaseAdmin
      .from('users')
      .select('*')
      .eq('email', email)
      .single();
    
    if (error || !user) {
      return res.status(401).json({ 
        success: false, 
        message: 'Invalid credentials' 
      });
    }
    
    const isValid = await bcrypt.compare(password, user.password_hash);
    if (!isValid) {
      return res.status(401).json({ 
        success: false, 
        message: 'Invalid credentials' 
      });
    }
    
    if (user.status !== 'active') {
      return res.status(403).json({ 
        success: false, 
        message: 'Account is suspended' 
      });
    }
    
    const token = jwt.sign(
      { userId: user.id, email: user.email, role: user.role },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );
    
    const { password_hash, ...userWithoutPassword } = user;
    
    res.json({
      success: true,
      message: 'Login successful',
      user: userWithoutPassword,
      token
    });
    
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Login failed', 
      error: error.message 
    });
  }
});

// Get Profile
app.get('/api/auth/profile', authenticateToken, async (req, res) => {
  try {
    const { data: user, error } = await supabaseAdmin
      .from('users')
      .select('*')
      .eq('id', req.user.id)
      .single();
    
    if (error || !user) {
      return res.status(404).json({ 
        success: false, 
        message: 'User not found' 
      });
    }
    
    const { password_hash, ...userWithoutPassword } = user;
    
    res.json({
      success: true,
      user: userWithoutPassword
    });
    
  } catch (error) {
    console.error('Profile error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch profile', 
      error: error.message 
    });
  }
});

// Update Profile
app.put('/api/auth/profile', authenticateToken, async (req, res) => {
  try {
    const { name, phone, location, bio, business_name, profile_picture } = req.body;
    
    const updateData = {
      name,
      phone,
      location,
      bio,
      business_name,
      profile_picture,
      updated_at: new Date().toISOString()
    };
    
    const { data: user, error } = await supabaseAdmin
      .from('users')
      .update(updateData)
      .eq('id', req.user.id)
      .select()
      .single();
    
    if (error) throw error;
    
    const { password_hash, ...userWithoutPassword } = user;
    
    res.json({
      success: true,
      message: 'Profile updated successfully',
      user: userWithoutPassword
    });
    
  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to update profile', 
      error: error.message 
    });
  }
});

// Change Password
app.post('/api/auth/change-password', authenticateToken, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ 
        success: false, 
        message: 'Current and new password required' 
      });
    }
    
    // Verify current password
    const { data: user } = await supabaseAdmin
      .from('users')
      .select('password_hash')
      .eq('id', req.user.id)
      .single();
    
    const isValid = await bcrypt.compare(currentPassword, user.password_hash);
    if (!isValid) {
      return res.status(401).json({ 
        success: false, 
        message: 'Current password is incorrect' 
      });
    }
    
    // Hash new password
    const salt = await bcrypt.genSalt(10);
    const newPasswordHash = await bcrypt.hash(newPassword, salt);
    
    await supabaseAdmin
      .from('users')
      .update({ 
        password_hash: newPasswordHash,
        updated_at: new Date().toISOString()
      })
      .eq('id', req.user.id);
    
    res.json({
      success: true,
      message: 'Password changed successfully'
    });
    
  } catch (error) {
    console.error('Change password error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to change password', 
      error: error.message 
    });
  }
});

// ============================================
// POST MANAGEMENT ENDPOINTS
// ============================================

// Create Post
app.post('/api/posts', authenticateToken, async (req, res) => {
  try {
    if (!req.user.subscription_active) {
      return res.status(403).json({ 
        success: false, 
        message: 'Active subscription required to post' 
      });
    }
    
    const postData = {
      id: uuidv4(),
      ...req.body,
      user_id: req.user.id,
      status: 'active',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    
    // Validate post type
    const validTypes = ['product', 'social', 'job', 'service', 'cv'];
    if (!validTypes.includes(postData.type)) {
      return res.status(400).json({ 
        success: false, 
        message: 'Invalid post type' 
      });
    }
    
    // Type-specific validation
    if (postData.type === 'product' && !postData.price) {
      return res.status(400).json({ 
        success: false, 
        message: 'Price is required for products' 
      });
    }
    
    if (postData.type === 'service' && (!postData.price_min || !postData.price_max)) {
      return res.status(400).json({ 
        success: false, 
        message: 'Price range required for services' 
      });
    }
    
    if (postData.type === 'job' && (!postData.salary_min || !postData.salary_max)) {
      return res.status(400).json({ 
        success: false, 
        message: 'Salary range required for jobs' 
      });
    }
    
    const { data: post, error } = await supabaseAdmin
      .from('posts')
      .insert([postData])
      .select()
      .single();
    
    if (error) throw error;
    
    // Handle boost if requested (and paid)
    if (postData.boosted) {
      if (!req.user.upgraded) {
        // Regular users need to pay for boost
        // This would require payment integration
        postData.boost_expires_at = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
      } else {
        // Premium users get free boost
        postData.boost_expires_at = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
      }
    }
    
    res.status(201).json({
      success: true,
      message: 'Post created successfully',
      post
    });
    
  } catch (error) {
    console.error('Create post error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to create post', 
      error: error.message 
    });
  }
});

// Get Posts with Filters
app.get('/api/posts', async (req, res) => {
  try {
    const { 
      type, 
      category, 
      search, 
      minPrice, 
      maxPrice, 
      location,
      page = 1, 
      limit = 20,
      sortBy = 'created_at',
      sortOrder = 'desc',
      boosted,
      userId
    } = req.query;
    
    let query = supabase
      .from('posts')
      .select(`
        *,
        user:users(id, name, email, profile_picture, verified, business_name)
      `)
      .eq('status', 'active');
    
    // Apply filters
    if (type) query = query.eq('type', type);
    if (category) query = query.eq('category', category);
    if (location) query = query.ilike('location', `%${location}%`);
    if (userId) query = query.eq('user_id', userId);
    if (boosted === 'true') query = query.eq('boosted', true);
    
    if (search) {
      query = query.or(`
        title.ilike.%${search}%,
        description.ilike.%${search}%,
        content.ilike.%${search}%,
        company.ilike.%${search}%
      `);
    }
    
    if (minPrice) query = query.gte('price', minPrice);
    if (maxPrice) query = query.lte('price', maxPrice);
    
    // Apply sorting
    const sortOptions = {
      'newest': { column: 'created_at', ascending: false },
      'oldest': { column: 'created_at', ascending: true },
      'price-low': { column: 'price', ascending: true },
      'price-high': { column: 'price', ascending: false },
      'popular': { column: 'views', ascending: false }
    };
    
    const sort = sortOptions[sortBy] || sortOptions.newest;
    query = query.order(sort.column, { ascending: sort.ascending });
    
    // Pagination
    const from = (parseInt(page) - 1) * parseInt(limit);
    const to = from + parseInt(limit) - 1;
    query = query.range(from, to);
    
    const { data: posts, error, count } = await query;
    
    if (error) throw error;
    
    // Get total count
    let countQuery = supabase
      .from('posts')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'active');
    
    if (type) countQuery = countQuery.eq('type', type);
    if (category) countQuery = countQuery.eq('category', category);
    
    const { count: totalCount } = await countQuery;
    
    res.json({
      success: true,
      posts: posts || [],
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: totalCount || 0,
        pages: Math.ceil((totalCount || 0) / parseInt(limit))
      }
    });
    
  } catch (error) {
    console.error('Get posts error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch posts', 
      error: error.message 
    });
  }
});

// Get Single Post
app.get('/api/posts/:id', async (req, res) => {
  try {
    const postId = req.params.id;
    
    // Increment view count
    await supabaseAdmin
      .from('posts')
      .update({ views: supabaseAdmin.rpc('increment', { x: 1 }) })
      .eq('id', postId);
    
    const { data: post, error } = await supabase
      .from('posts')
      .select(`
        *,
        user:users(*)
      `)
      .eq('id', postId)
      .single();
    
    if (error || !post) {
      return res.status(404).json({ 
        success: false, 
        message: 'Post not found' 
      });
    }
    
    res.json({
      success: true,
      post
    });
    
  } catch (error) {
    console.error('Get post error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch post', 
      error: error.message 
    });
  }
});

// Update Post
app.put('/api/posts/:id', authenticateToken, async (req, res) => {
  try {
    const postId = req.params.id;
    
    // Check ownership
    const { data: existingPost } = await supabaseAdmin
      .from('posts')
      .select('user_id')
      .eq('id', postId)
      .single();
    
    if (!existingPost) {
      return res.status(404).json({ 
        success: false, 
        message: 'Post not found' 
      });
    }
    
    if (existingPost.user_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ 
        success: false, 
        message: 'Not authorized to update this post' 
      });
    }
    
    const updateData = {
      ...req.body,
      updated_at: new Date().toISOString()
    };
    
    const { data: post, error } = await supabaseAdmin
      .from('posts')
      .update(updateData)
      .eq('id', postId)
      .select()
      .single();
    
    if (error) throw error;
    
    res.json({
      success: true,
      message: 'Post updated successfully',
      post
    });
    
  } catch (error) {
    console.error('Update post error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to update post', 
      error: error.message 
    });
  }
});

// Delete Post
app.delete('/api/posts/:id', authenticateToken, async (req, res) => {
  try {
    const postId = req.params.id;
    
    const { data: existingPost } = await supabaseAdmin
      .from('posts')
      .select('user_id')
      .eq('id', postId)
      .single();
    
    if (!existingPost) {
      return res.status(404).json({ 
        success: false, 
        message: 'Post not found' 
      });
    }
    
    if (existingPost.user_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ 
        success: false, 
        message: 'Not authorized to delete this post' 
      });
    }
    
    await supabaseAdmin
      .from('posts')
      .update({ 
        status: 'deleted',
        updated_at: new Date().toISOString()
      })
      .eq('id', postId);
    
    res.json({
      success: true,
      message: 'Post deleted successfully'
    });
    
  } catch (error) {
    console.error('Delete post error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to delete post', 
      error: error.message 
    });
  }
});

// Like/Unlike Post
app.post('/api/posts/:id/like', authenticateToken, async (req, res) => {
  try {
    const postId = req.params.id;
    
    const { data: post } = await supabaseAdmin
      .from('posts')
      .select('likes')
      .eq('id', postId)
      .single();
    
    if (!post) {
      return res.status(404).json({ 
        success: false, 
        message: 'Post not found' 
      });
    }
    
    const likes = post.likes || [];
    const userId = req.user.id;
    
    let updatedLikes;
    let liked = false;
    
    if (likes.includes(userId)) {
      // Unlike
      updatedLikes = likes.filter(id => id !== userId);
    } else {
      // Like
      updatedLikes = [...likes, userId];
      liked = true;
    }
    
    await supabaseAdmin
      .from('posts')
      .update({ 
        likes: updatedLikes,
        updated_at: new Date().toISOString()
      })
      .eq('id', postId);
    
    res.json({
      success: true,
      liked,
      likes: updatedLikes.length
    });
    
  } catch (error) {
    console.error('Like post error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to like post', 
      error: error.message 
    });
  }
});

// ============================================
// PAYMENT & SUBSCRIPTION ENDPOINTS
// ============================================

// Request Subscription
app.post('/api/subscriptions', authenticateToken, async (req, res) => {
  try {
    const { transactionCode } = req.body;
    
    if (!transactionCode) {
      return res.status(400).json({ 
        success: false, 
        message: 'Transaction code required' 
      });
    }
    
    // Check if already subscribed
    if (req.user.subscription_active) {
      return res.status(400).json({ 
        success: false, 
        message: 'Already subscribed' 
      });
    }
    
    const paymentData = {
      id: uuidv4(),
      user_id: req.user.id,
      amount: SUB_AMOUNT,
      type: 'subscription',
      transaction_code: transactionCode,
      status: 'pending',
      created_at: new Date().toISOString()
    };
    
    const { error } = await supabaseAdmin
      .from('payments')
      .insert([paymentData]);
    
    if (error) throw error;
    
    // Create notification for admin
    const notificationData = {
      id: uuidv4(),
      user_id: req.user.id,
      title: 'New Subscription Request',
      message: `User ${req.user.name} (${req.user.email}) has requested subscription with transaction code: ${transactionCode}`,
      type: 'payment',
      data: { paymentId: paymentData.id, amount: SUB_AMOUNT },
      created_at: new Date().toISOString()
    };
    
    await supabaseAdmin
      .from('notifications')
      .insert([notificationData]);
    
    res.json({
      success: true,
      message: 'Subscription request submitted for admin approval',
      payment: paymentData
    });
    
  } catch (error) {
    console.error('Subscription error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to process subscription', 
      error: error.message 
    });
  }
});

// Request Upgrade
app.post('/api/upgrade', authenticateToken, async (req, res) => {
  try {
    const { transactionCode } = req.body;
    
    if (!transactionCode) {
      return res.status(400).json({ 
        success: false, 
        message: 'Transaction code required' 
      });
    }
    
    if (req.user.upgraded) {
      return res.status(400).json({ 
        success: false, 
        message: 'Already upgraded' 
      });
    }
    
    const paymentData = {
      id: uuidv4(),
      user_id: req.user.id,
      amount: UPGRADE_AMOUNT,
      type: 'upgrade',
      transaction_code: transactionCode,
      status: 'pending',
      created_at: new Date().toISOString()
    };
    
    const { error } = await supabaseAdmin
      .from('payments')
      .insert([paymentData]);
    
    if (error) throw error;
    
    // Handle referral commission for upgrade
    if (req.user.referral_from) {
      const { data: referrer } = await supabaseAdmin
        .from('users')
        .select('id')
        .eq('referral_code', req.user.referral_from)
        .single();
      
      if (referrer) {
        const referralData = {
          id: uuidv4(),
          referrer_id: referrer.id,
          referred_user_id: req.user.id,
          commission: REFERRAL_UPGRADE_COMMISSION,
          type: 'upgrade',
          status: 'pending',
          created_at: new Date().toISOString()
        };
        
        await supabaseAdmin
          .from('referrals')
          .insert([referralData]);
      }
    }
    
    // Create notification
    const notificationData = {
      id: uuidv4(),
      user_id: req.user.id,
      title: 'New Upgrade Request',
      message: `User ${req.user.name} has requested premium upgrade with transaction code: ${transactionCode}`,
      type: 'payment',
      data: { paymentId: paymentData.id, amount: UPGRADE_AMOUNT },
      created_at: new Date().toISOString()
    };
    
    await supabaseAdmin
      .from('notifications')
      .insert([notificationData]);
    
    res.json({
      success: true,
      message: 'Upgrade request submitted for admin approval',
      payment: paymentData
    });
    
  } catch (error) {
    console.error('Upgrade error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to process upgrade', 
      error: error.message 
    });
  }
});

// Get User Payments
app.get('/api/payments', authenticateToken, async (req, res) => {
  try {
    const { data: payments, error } = await supabaseAdmin
      .from('payments')
      .select('*')
      .eq('user_id', req.user.id)
      .order('created_at', { ascending: false });
    
    if (error) throw error;
    
    res.json({
      success: true,
      payments: payments || []
    });
    
  } catch (error) {
    console.error('Get payments error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch payments', 
      error: error.message 
    });
  }
});

// ============================================
// WITHDRAWAL ENDPOINTS
// ============================================

// Request Withdrawal
app.post('/api/withdrawals', authenticateToken, async (req, res) => {
  try {
    const { amount, mpesaNumber } = req.body;
    
    const withdrawalAmount = parseFloat(amount);
    
    if (!withdrawalAmount || withdrawalAmount < 100) {
      return res.status(400).json({ 
        success: false, 
        message: 'Minimum withdrawal is KES 100' 
      });
    }
    
    if (!mpesaNumber || !/^2547\d{8}$/.test(mpesaNumber)) {
      return res.status(400).json({ 
        success: false, 
        message: 'Valid M-Pesa number required (2547XXXXXXXX)' 
      });
    }
    
    // Check balance
    if (withdrawalAmount > req.user.earnings_balance) {
      return res.status(400).json({ 
        success: false, 
        message: 'Insufficient balance' 
      });
    }
    
    // Calculate fee
    const fee = withdrawalAmount * (WITHDRAWAL_FEE_PERCENT / 100);
    const netAmount = withdrawalAmount - fee;
    
    const withdrawalData = {
      id: uuidv4(),
      user_id: req.user.id,
      amount: withdrawalAmount,
      fee: parseFloat(fee.toFixed(2)),
      net_amount: parseFloat(netAmount.toFixed(2)),
      mpesa_number: mpesaNumber,
      status: 'pending',
      created_at: new Date().toISOString()
    };
    
    const { error } = await supabaseAdmin
      .from('withdrawals')
      .insert([withdrawalData]);
    
    if (error) throw error;
    
    // Create notification
    const notificationData = {
      id: uuidv4(),
      user_id: req.user.id,
      title: 'New Withdrawal Request',
      message: `User ${req.user.name} has requested withdrawal of KES ${withdrawalAmount} to ${mpesaNumber}`,
      type: 'withdrawal',
      data: { 
        withdrawalId: withdrawalData.id, 
        amount: withdrawalAmount,
        mpesaNumber 
      },
      created_at: new Date().toISOString()
    };
    
    await supabaseAdmin
      .from('notifications')
      .insert([notificationData]);
    
    res.json({
      success: true,
      message: 'Withdrawal request submitted for admin approval',
      withdrawal: withdrawalData
    });
    
  } catch (error) {
    console.error('Withdrawal error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to process withdrawal', 
      error: error.message 
    });
  }
});

// Get User Withdrawals
app.get('/api/withdrawals', authenticateToken, async (req, res) => {
  try {
    const { data: withdrawals, error } = await supabaseAdmin
      .from('withdrawals')
      .select('*')
      .eq('user_id', req.user.id)
      .order('created_at', { ascending: false });
    
    if (error) throw error;
    
    res.json({
      success: true,
      withdrawals: withdrawals || []
    });
    
  } catch (error) {
    console.error('Get withdrawals error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch withdrawals', 
      error: error.message 
    });
  }
});

// ============================================
// REFERRAL ENDPOINTS
// ============================================

// Get Referral Stats
app.get('/api/referrals/stats', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    
    // Get referrals
    const { data: referrals, error: referralsError } = await supabaseAdmin
      .from('referrals')
      .select('*')
      .eq('referrer_id', userId);
    
    if (referralsError) throw referralsError;
    
    // Calculate stats
    const totalReferrals = referrals?.length || 0;
    const pendingReferrals = referrals?.filter(r => r.status === 'pending').length || 0;
    const approvedReferrals = referrals?.filter(r => r.status === 'approved').length || 0;
    const totalCommission = referrals
      ?.filter(r => r.status === 'approved')
      .reduce((sum, r) => sum + (r.commission || 0), 0) || 0;
    
    res.json({
      success: true,
      stats: {
        totalReferrals,
        pendingReferrals,
        approvedReferrals,
        totalCommission
      },
      referrals: referrals || []
    });
    
  } catch (error) {
    console.error('Referral stats error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch referral stats', 
      error: error.message 
    });
  }
});

// ============================================
// SHOP ENDPOINTS
// ============================================

// Create/Update Shop
app.post('/api/shops', authenticateToken, async (req, res) => {
  try {
    if (!req.user.upgraded) {
      return res.status(403).json({ 
        success: false, 
        message: 'Premium upgrade required to create shop' 
      });
    }
    
    const { 
      name, 
      description, 
      category, 
      logo, 
      banner, 
      whatsapp, 
      location, 
      business_hours 
    } = req.body;
    
    if (!name || !whatsapp) {
      return res.status(400).json({ 
        success: false, 
        message: 'Shop name and WhatsApp are required' 
      });
    }
    
    const shopData = {
      id: uuidv4(),
      user_id: req.user.id,
      name,
      description,
      category,
      logo,
      banner,
      whatsapp,
      location,
      business_hours,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    
    // Check if shop exists
    const { data: existingShop } = await supabaseAdmin
      .from('shops')
      .select('id')
      .eq('user_id', req.user.id)
      .single();
    
    let result;
    if (existingShop) {
      // Update
      const { data, error } = await supabaseAdmin
        .from('shops')
        .update({
          ...shopData,
          id: existingShop.id,
          updated_at: new Date().toISOString()
        })
        .eq('id', existingShop.id)
        .select()
        .single();
      
      if (error) throw error;
      result = data;
    } else {
      // Create
      const { data, error } = await supabaseAdmin
        .from('shops')
        .insert([shopData])
        .select()
        .single();
      
      if (error) throw error;
      result = data;
    }
    
    res.json({
      success: true,
      message: existingShop ? 'Shop updated successfully' : 'Shop created successfully',
      shop: result
    });
    
  } catch (error) {
    console.error('Shop error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to process shop request', 
      error: error.message 
    });
  }
});

// Get User Shop
app.get('/api/shops/me', authenticateToken, async (req, res) => {
  try {
    const { data: shop, error } = await supabaseAdmin
      .from('shops')
      .select('*')
      .eq('user_id', req.user.id)
      .single();
    
    if (error && error.code !== 'PGRST116') {
      throw error;
    }
    
    // Get shop stats
    if (shop) {
      const { count: productsCount } = await supabaseAdmin
        .from('posts')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', req.user.id)
        .eq('type', 'product')
        .eq('status', 'active');
      
      const { count: servicesCount } = await supabaseAdmin
        .from('posts')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', req.user.id)
        .eq('type', 'service')
        .eq('status', 'active');
      
      shop.stats = {
        productsCount: productsCount || 0,
        servicesCount: servicesCount || 0,
        totalSales: shop.total_sales || 0,
        rating: shop.rating || 0
      };
    }
    
    res.json({
      success: true,
      shop: shop || null
    });
    
  } catch (error) {
    console.error('Get shop error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch shop', 
      error: error.message 
    });
  }
});

// Get Shop Products
app.get('/api/shops/products', authenticateToken, async (req, res) => {
  try {
    const { data: products, error } = await supabaseAdmin
      .from('posts')
      .select('*')
      .eq('user_id', req.user.id)
      .eq('type', 'product')
      .eq('status', 'active')
      .order('created_at', { ascending: false });
    
    if (error) throw error;
    
    res.json({
      success: true,
      products: products || []
    });
    
  } catch (error) {
    console.error('Shop products error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch shop products', 
      error: error.message 
    });
  }
});

// Get Shop Services
app.get('/api/shops/services', authenticateToken, async (req, res) => {
  try {
    const { data: services, error } = await supabaseAdmin
      .from('posts')
      .select('*')
      .eq('user_id', req.user.id)
      .eq('type', 'service')
      .eq('status', 'active')
      .order('created_at', { ascending: false });
    
    if (error) throw error;
    
    res.json({
      success: true,
      services: services || []
    });
    
  } catch (error) {
    console.error('Shop services error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch shop services', 
      error: error.message 
    });
  }
});

// ============================================
// CV ENDPOINTS
// ============================================

// Upload CV
app.post('/api/cvs', authenticateToken, async (req, res) => {
  try {
    const { 
      title, 
      file_url, 
      summary, 
      skills, 
      experience, 
      expected_salary, 
      location 
    } = req.body;
    
    if (!title || !file_url) {
      return res.status(400).json({ 
        success: false, 
        message: 'Title and file URL are required' 
      });
    }
    
    const cvData = {
      id: uuidv4(),
      user_id: req.user.id,
      title,
      file_url,
      summary: summary || '',
      skills: skills ? skills.split(',').map(s => s.trim()) : [],
      experience: experience || '',
      expected_salary: expected_salary ? parseFloat(expected_salary) : null,
      location: location || '',
      uploaded_at: new Date().toISOString(),
      status: 'active'
    };
    
    const { data: cv, error } = await supabaseAdmin
      .from('cvs')
      .insert([cvData])
      .select()
      .single();
    
    if (error) throw error;
    
    res.status(201).json({
      success: true,
      message: 'CV uploaded successfully',
      cv
    });
    
  } catch (error) {
    console.error('CV upload error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to upload CV', 
      error: error.message 
    });
  }
});

// Get User CVs
app.get('/api/cvs', authenticateToken, async (req, res) => {
  try {
    const { data: cvs, error } = await supabaseAdmin
      .from('cvs')
      .select('*')
      .eq('user_id', req.user.id)
      .eq('status', 'active')
      .order('uploaded_at', { ascending: false });
    
    if (error) throw error;
    
    res.json({
      success: true,
      cvs: cvs || []
    });
    
  } catch (error) {
    console.error('Get CVs error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch CVs', 
      error: error.message 
    });
  }
});

// Delete CV
app.delete('/api/cvs/:id', authenticateToken, async (req, res) => {
  try {
    const cvId = req.params.id;
    
    const { data: existingCV } = await supabaseAdmin
      .from('cvs')
      .select('user_id')
      .eq('id', cvId)
      .single();
    
    if (!existingCV) {
      return res.status(404).json({ 
        success: false, 
        message: 'CV not found' 
      });
    }
    
    if (existingCV.user_id !== req.user.id) {
      return res.status(403).json({ 
        success: false, 
        message: 'Not authorized to delete this CV' 
      });
    }
    
    await supabaseAdmin
      .from('cvs')
      .update({ 
        status: 'deleted',
        updated_at: new Date().toISOString()
      })
      .eq('id', cvId);
    
    res.json({
      success: true,
      message: 'CV deleted successfully'
    });
    
  } catch (error) {
    console.error('Delete CV error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to delete CV', 
      error: error.message 
    });
  }
});

// ============================================
// STATISTICS ENDPOINTS
// ============================================

// Platform Stats
app.get('/api/stats', async (req, res) => {
  try {
    const [
      { count: totalUsers },
      { count: totalPosts },
      { count: activePosts },
      { data: earningsData },
      { count: pendingPayments }
    ] = await Promise.all([
      supabaseAdmin.from('users').select('*', { count: 'exact', head: true }).eq('status', 'active'),
      supabaseAdmin.from('posts').select('*', { count: 'exact', head: true }),
      supabaseAdmin.from('posts').select('*', { count: 'exact', head: true }).eq('status', 'active'),
      supabaseAdmin.from('withdrawals').select('amount').eq('status', 'approved'),
      supabaseAdmin.from('payments').select('*', { count: 'exact', head: true }).eq('status', 'pending')
    ]);
    
    const totalEarnings = earningsData?.reduce((sum, item) => sum + (item.amount || 0), 0) || 0;
    
    res.json({
      success: true,
      stats: {
        totalUsers: totalUsers || 0,
        totalPosts: totalPosts || 0,
        activePosts: activePosts || 0,
        totalEarnings,
        pendingPayments: pendingPayments || 0,
        activeTransactions: pendingPayments || 0
      }
    });
    
  } catch (error) {
    console.error('Stats error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch statistics', 
      error: error.message 
    });
  }
});

// User Dashboard Stats
app.get('/api/users/stats', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    
    const [
      { count: productsCount },
      { count: servicesCount },
      { count: jobsCount },
      { count: socialCount },
      { count: totalReferrals },
      { data: referralsData },
      { data: withdrawalsData },
      { data: postsData }
    ] = await Promise.all([
      supabaseAdmin.from('posts').select('*', { count: 'exact', head: true })
        .eq('user_id', userId).eq('type', 'product').eq('status', 'active'),
      supabaseAdmin.from('posts').select('*', { count: 'exact', head: true })
        .eq('user_id', userId).eq('type', 'service').eq('status', 'active'),
      supabaseAdmin.from('posts').select('*', { count: 'exact', head: true })
        .eq('user_id', userId).eq('type', 'job').eq('status', 'active'),
      supabaseAdmin.from('posts').select('*', { count: 'exact', head: true })
        .eq('user_id', userId).eq('type', 'social').eq('status', 'active'),
      supabaseAdmin.from('referrals').select('*', { count: 'exact', head: true })
        .eq('referrer_id', userId).eq('status', 'approved'),
      supabaseAdmin.from('referrals').select('commission')
        .eq('referrer_id', userId).eq('status', 'approved'),
      supabaseAdmin.from('withdrawals').select('amount')
        .eq('user_id', userId).eq('status', 'approved'),
      supabaseAdmin.from('posts').select('views')
        .eq('user_id', userId)
    ]);
    
    const totalViews = postsData?.reduce((sum, post) => sum + (post.views || 0), 0) || 0;
    const totalEarned = referralsData?.reduce((sum, r) => sum + (r.commission || 0), 0) || 0;
    const totalWithdrawn = withdrawalsData?.reduce((sum, w) => sum + (w.amount || 0), 0) || 0;
    const availableBalance = req.user.earnings_balance || 0;
    
    res.json({
      success: true,
      stats: {
        productsCount: productsCount || 0,
        servicesCount: servicesCount || 0,
        jobsCount: jobsCount || 0,
        socialCount: socialCount || 0,
        totalViews,
        totalReferrals: totalReferrals || 0,
        totalEarned,
        totalWithdrawn,
        availableBalance
      }
    });
    
  } catch (error) {
    console.error('User stats error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch user statistics', 
      error: error.message 
    });
  }
});

// ============================================
// ADMIN ENDPOINTS
// ============================================

// Admin Dashboard Stats
app.get('/api/admin/stats', authenticateToken, isAdmin, async (req, res) => {
  try {
    const [
      { count: totalUsers },
      { count: totalPosts },
      { count: pendingApprovals },
      { data: revenueData },
      { count: activeSubscriptions },
      { count: pendingWithdrawals }
    ] = await Promise.all([
      supabaseAdmin.from('users').select('*', { count: 'exact', head: true }),
      supabaseAdmin.from('posts').select('*', { count: 'exact', head: true }).eq('status', 'active'),
      supabaseAdmin.from('payments').select('*', { count: 'exact', head: true }).eq('status', 'pending'),
      supabaseAdmin.from('payments').select('amount').eq('status', 'approved'),
      supabaseAdmin.from('users').select('*', { count: 'exact', head: true }).eq('subscription_active', true),
      supabaseAdmin.from('withdrawals').select('*', { count: 'exact', head: true }).eq('status', 'pending')
    ]);
    
    const totalRevenue = revenueData?.reduce((sum, p) => sum + (p.amount || 0), 0) || 0;
    
    res.json({
      success: true,
      stats: {
        totalUsers: totalUsers || 0,
        totalPosts: totalPosts || 0,
        pendingApprovals: pendingApprovals || 0,
        totalRevenue,
        activeSubscriptions: activeSubscriptions || 0,
        pendingWithdrawals: pendingWithdrawals || 0
      }
    });
    
  } catch (error) {
    console.error('Admin stats error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch admin statistics', 
      error: error.message 
    });
  }
});

// Get Pending Payments
app.get('/api/admin/payments/pending', authenticateToken, isAdmin, async (req, res) => {
  try {
    const { data: payments, error } = await supabaseAdmin
      .from('payments')
      .select(`
        *,
        user:users(name, email, phone)
      `)
      .eq('status', 'pending')
      .order('created_at', { ascending: false });
    
    if (error) throw error;
    
    res.json({
      success: true,
      payments: payments || []
    });
    
  } catch (error) {
    console.error('Pending payments error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch pending payments', 
      error: error.message 
    });
  }
});

// Approve Payment
app.put('/api/admin/payments/:id/approve', authenticateToken, isAdmin, async (req, res) => {
  try {
    const paymentId = req.params.id;
    
    // Get payment
    const { data: payment, error: paymentError } = await supabaseAdmin
      .from('payments')
      .select('*')
      .eq('id', paymentId)
      .single();
    
    if (paymentError || !payment) {
      return res.status(404).json({ 
        success: false, 
        message: 'Payment not found' 
      });
    }
    
    // Update payment status
    const { error: updateError } = await supabaseAdmin
      .from('payments')
      .update({ 
        status: 'approved',
        updated_at: new Date().toISOString()
      })
      .eq('id', paymentId);
    
    if (updateError) throw updateError;
    
    // Update user based on payment type
    if (payment.type === 'subscription') {
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 7); // 7 days
      
      await supabaseAdmin
        .from('users')
        .update({
          subscription_active: true,
          subscription_expires_at: expiresAt.toISOString(),
          updated_at: new Date().toISOString()
        })
        .eq('id', payment.user_id);
      
      // Handle referral commission
      const { data: user } = await supabaseAdmin
        .from('users')
        .select('referral_from')
        .eq('id', payment.user_id)
        .single();
      
      if (user?.referral_from) {
        const { data: referrer } = await supabaseAdmin
          .from('users')
          .select('id')
          .eq('referral_code', user.referral_from)
          .single();
        
        if (referrer) {
          // Update referral status
          await supabaseAdmin
            .from('referrals')
            .update({
              status: 'approved',
              updated_at: new Date().toISOString()
            })
            .eq('referrer_id', referrer.id)
            .eq('referred_user_id', payment.user_id)
            .eq('type', 'subscription');
          
          // Update referrer earnings
          await supabaseAdmin
            .from('users')
            .update({
              earnings_balance: supabaseAdmin.rpc('increment', { x: REFERRAL_SUB_COMMISSION }),
              earnings_total: supabaseAdmin.rpc('increment', { x: REFERRAL_SUB_COMMISSION }),
              updated_at: new Date().toISOString()
            })
            .eq('id', referrer.id);
        }
      }
    } else if (payment.type === 'upgrade') {
      await supabaseAdmin
        .from('users')
        .update({
          upgraded: true,
          upgraded_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .eq('id', payment.user_id);
      
      // Handle upgrade referral commission
      const { data: referral } = await supabaseAdmin
        .from('referrals')
        .select('*')
        .eq('referred_user_id', payment.user_id)
        .eq('type', 'upgrade')
        .eq('status', 'pending')
        .single();
      
      if (referral) {
        await supabaseAdmin
          .from('referrals')
          .update({
            status: 'approved',
            updated_at: new Date().toISOString()
          })
          .eq('id', referral.id);
        
        await supabaseAdmin
          .from('users')
          .update({
            earnings_balance: supabaseAdmin.rpc('increment', { x: REFERRAL_UPGRADE_COMMISSION }),
            earnings_total: supabaseAdmin.rpc('increment', { x: REFERRAL_UPGRADE_COMMISSION }),
            updated_at: new Date().toISOString()
          })
          .eq('id', referral.referrer_id);
      }
    }
    
    res.json({
      success: true,
      message: 'Payment approved successfully'
    });
    
  } catch (error) {
    console.error('Approve payment error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to approve payment', 
      error: error.message 
    });
  }
});

// Get Pending Withdrawals
app.get('/api/admin/withdrawals/pending', authenticateToken, isAdmin, async (req, res) => {
  try {
    const { data: withdrawals, error } = await supabaseAdmin
      .from('withdrawals')
      .select(`
        *,
        user:users(name, email, phone)
      `)
      .eq('status', 'pending')
      .order('created_at', { ascending: false });
    
    if (error) throw error;
    
    res.json({
      success: true,
      withdrawals: withdrawals || []
    });
    
  } catch (error) {
    console.error('Pending withdrawals error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch pending withdrawals', 
      error: error.message 
    });
  }
});

// Approve Withdrawal
app.put('/api/admin/withdrawals/:id/approve', authenticateToken, isAdmin, async (req, res) => {
  try {
    const withdrawalId = req.params.id;
    
    // Get withdrawal
    const { data: withdrawal, error: withdrawalError } = await supabaseAdmin
      .from('withdrawals')
      .select('*')
      .eq('id', withdrawalId)
      .single();
    
    if (withdrawalError || !withdrawal) {
      return res.status(404).json({ 
        success: false, 
        message: 'Withdrawal not found' 
      });
    }
    
    // Check user balance
    const { data: user } = await supabaseAdmin
      .from('users')
      .select('earnings_balance, earnings_withdrawn')
      .eq('id', withdrawal.user_id)
      .single();
    
    if (user.earnings_balance < withdrawal.amount) {
      return res.status(400).json({ 
        success: false, 
        message: 'User has insufficient balance' 
      });
    }
    
    // Update withdrawal status
    const { error: updateError } = await supabaseAdmin
      .from('withdrawals')
      .update({ 
        status: 'approved',
        approved_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq('id', withdrawalId);
    
    if (updateError) throw updateError;
    
    // Update user balance
    await supabaseAdmin
      .from('users')
      .update({
        earnings_balance: user.earnings_balance - withdrawal.amount,
        earnings_withdrawn: user.earnings_withdrawn + withdrawal.amount,
        updated_at: new Date().toISOString()
      })
      .eq('id', withdrawal.user_id);
    
    // TODO: Integrate with M-Pesa API here
    
    res.json({
      success: true,
      message: 'Withdrawal approved and processed'
    });
    
  } catch (error) {
    console.error('Approve withdrawal error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to approve withdrawal', 
      error: error.message 
    });
  }
});

// Get All Users (Admin)
app.get('/api/admin/users', authenticateToken, isAdmin, async (req, res) => {
  try {
    const { page = 1, limit = 50, search, status, role } = req.query;
    
    let query = supabaseAdmin
      .from('users')
      .select('id, name, email, phone, role, status, subscription_active, upgraded, earnings_balance, created_at', { count: 'exact' });
    
    if (search) {
      query = query.or(`name.ilike.%${search}%,email.ilike.%${search}%,phone.ilike.%${search}%`);
    }
    
    if (status) query = query.eq('status', status);
    if (role) query = query.eq('role', role);
    
    query = query
      .order('created_at', { ascending: false })
      .range((page - 1) * limit, page * limit - 1);
    
    const { data: users, error, count } = await query;
    
    if (error) throw error;
    
    res.json({
      success: true,
      users: users || [],
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: count || 0,
        pages: Math.ceil((count || 0) / parseInt(limit))
      }
    });
    
  } catch (error) {
    console.error('Admin users error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch users', 
      error: error.message 
    });
  }
});

// Update User (Admin)
app.put('/api/admin/users/:id', authenticateToken, isAdmin, async (req, res) => {
  try {
    const userId = req.params.id;
    const { status, role, subscription_active, upgraded, verified } = req.body;
    
    const updateData = {
      status,
      role,
      subscription_active,
      upgraded,
      verified,
      updated_at: new Date().toISOString()
    };
    
    // Remove undefined values
    Object.keys(updateData).forEach(key => 
      updateData[key] === undefined && delete updateData[key]
    );
    
    const { data: user, error } = await supabaseAdmin
      .from('users')
      .update(updateData)
      .eq('id', userId)
      .select()
      .single();
    
    if (error) throw error;
    
    res.json({
      success: true,
      message: 'User updated successfully',
      user
    });
    
  } catch (error) {
    console.error('Update user error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to update user', 
      error: error.message 
    });
  }
});

// ============================================
// NOTIFICATION ENDPOINTS
// ============================================

// Get User Notifications
app.get('/api/notifications', authenticateToken, async (req, res) => {
  try {
    const { unread } = req.query;
    
    let query = supabaseAdmin
      .from('notifications')
      .select('*')
      .eq('user_id', req.user.id)
      .order('created_at', { ascending: false });
    
    if (unread === 'true') {
      query = query.eq('read', false);
    }
    
    const { data: notifications, error } = await query;
    
    if (error) throw error;
    
    res.json({
      success: true,
      notifications: notifications || []
    });
    
  } catch (error) {
    console.error('Notifications error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch notifications', 
      error: error.message 
    });
  }
});

// Mark Notification as Read
app.put('/api/notifications/:id/read', authenticateToken, async (req, res) => {
  try {
    const notificationId = req.params.id;
    
    await supabaseAdmin
      .from('notifications')
      .update({ 
        read: true,
        updated_at: new Date().toISOString()
      })
      .eq('id', notificationId)
      .eq('user_id', req.user.id);
    
    res.json({
      success: true,
      message: 'Notification marked as read'
    });
    
  } catch (error) {
    console.error('Mark notification read error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to mark notification as read', 
      error: error.message 
    });
  }
});

// Mark All Notifications as Read
app.put('/api/notifications/read-all', authenticateToken, async (req, res) => {
  try {
    await supabaseAdmin
      .from('notifications')
      .update({ 
        read: true,
        updated_at: new Date().toISOString()
      })
      .eq('user_id', req.user.id)
      .eq('read', false);
    
    res.json({
      success: true,
      message: 'All notifications marked as read'
    });
    
  } catch (error) {
    console.error('Mark all notifications read error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to mark notifications as read', 
      error: error.message 
    });
  }
});

// ============================================
// HEALTH & UTILITY ENDPOINTS
// ============================================

// Health Check
app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    message: '🚀 SOKOPLUS API is running',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
    environment: process.env.NODE_ENV || 'development',
    database: 'Supabase',
    features: {
      authentication: true,
      marketplace: true,
      payments: true,
      referrals: true,
      shops: true,
      admin: true
    }
  });
});

// Get Payment Details
app.get('/api/payment-details', (req, res) => {
  res.json({
    success: true,
    details: {
      paybill: process.env.MPESA_PAYBILL || '222111',
      account: process.env.MPESA_ACCOUNT || '5414200',
      subscription: {
        amount: SUB_AMOUNT,
        description: 'Weekly Subscription'
      },
      upgrade: {
        amount: UPGRADE_AMOUNT,
        description: 'Monthly Premium Upgrade'
      },
      boost: {
        amount: 100,
        description: 'Post Boost'
      }
    }
  });
});

// ============================================
// ERROR HANDLING
// ============================================

// 404 Handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: 'Endpoint not found',
    path: req.path,
    method: req.method
  });
});

// Error Handler
app.use((err, req, res, next) => {
  console.error('🚨 Unhandled Error:', err);
  
  res.status(err.status || 500).json({
    success: false,
    message: err.message || 'Internal server error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
});

// ============================================
// SERVER INITIALIZATION
// ============================================

const PORT = process.env.PORT || 3000;

// Initialize database on startup
initializeDatabase();

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`
    🚀 SOKOPLUS Backend Server Started!
    ====================================
    📡 Port: ${PORT}
    🌐 Environment: ${process.env.NODE_ENV || 'development'}
    🗄️  Database: Supabase
    🔐 JWT Secret: Configured
    👑 Admin: ${process.env.ADMIN_EMAIL}
    💰 Subscription: KES ${SUB_AMOUNT}
    ⭐ Upgrade: KES ${UPGRADE_AMOUNT}
    ====================================
    📊 Health Check: http://localhost:${PORT}/api/health
    📝 API Documentation: Available at /api/docs
    `);
  });
}

module.exports = app;
