-- OOOSH Driver Verification Database Schema

-- Jobs table (from Monday.com or manual entry)
CREATE TABLE jobs (
    id VARCHAR(50) PRIMARY KEY,
    job_name VARCHAR(255) NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    vehicle_type VARCHAR(100),
    client_name VARCHAR(255),
    status ENUM('active', 'completed', 'cancelled') DEFAULT 'active',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Drivers table
CREATE TABLE drivers (
    id INT AUTO_INCREMENT PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    name VARCHAR(255),
    phone VARCHAR(20),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    INDEX idx_email (email)
);

-- Email verification codes
CREATE TABLE email_verifications (
    id INT AUTO_INCREMENT PRIMARY KEY,
    email VARCHAR(255) NOT NULL,
    code VARCHAR(6) NOT NULL,
    job_id VARCHAR(50) NOT NULL,
    verified BOOLEAN DEFAULT FALSE,
    expires_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    INDEX idx_email_job (email, job_id),
    INDEX idx_code (code),
    FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
);

-- Driver verifications (per job)
CREATE TABLE driver_verifications (
    id INT AUTO_INCREMENT PRIMARY KEY,
    driver_id INT NOT NULL,
    job_id VARCHAR(50) NOT NULL,
    status ENUM('pending', 'verified', 'rejected', 'expired') DEFAULT 'pending',
    
    -- Document status
    license_valid BOOLEAN DEFAULT FALSE,
    license_expiry DATE,
    poa1_valid BOOLEAN DEFAULT FALSE,
    poa1_type VARCHAR(100),
    poa1_expiry DATE,
    poa2_valid BOOLEAN DEFAULT FALSE,
    poa2_type VARCHAR(100), 
    poa2_expiry DATE,
    dvla_check_valid BOOLEAN DEFAULT FALSE,
    dvla_check_date DATE,
    
    -- Idenfy integration data
    idenfy_session_id VARCHAR(255),
    idenfy_status VARCHAR(50),
    idenfy_webhook_data JSON,
    
    -- Insurance compliance
    points_count INT DEFAULT 0,
    insurance_approved BOOLEAN DEFAULT FALSE,
    manual_override BOOLEAN DEFAULT FALSE,
    override_reason TEXT,
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    UNIQUE KEY unique_driver_job (driver_id, job_id),
    FOREIGN KEY (driver_id) REFERENCES drivers(id) ON DELETE CASCADE,
    FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
);

-- Sample data for testing
INSERT INTO jobs (id, job_name, start_date, end_date, vehicle_type, client_name) VALUES
('JOB001', 'London Event Transport', '2025-07-15', '2025-07-20', 'Mercedes Sprinter', 'Events Ltd'),
('JOB002', 'Corporate Retreat', '2025-07-25', '2025-07-27', 'Ford Transit', 'TechCorp'),
('JOB003', 'Wedding Transport', '2025-08-10', '2025-08-10', 'Luxury Coach', 'Happy Couple');
