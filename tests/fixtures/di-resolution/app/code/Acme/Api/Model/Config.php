<?php
declare(strict_types=1);

namespace Acme\Api\Model;

class Config
{
    private const XML_PATH_MODE = 'acme/general/mode';

    public function __construct(private readonly \Magento\Framework\App\Config\ScopeConfigInterface $scopeConfig)
    {
    }

    public function getMode(?int $websiteId = null): string
    {
        return (string)$this->scopeConfig->getValue(self::XML_PATH_MODE, 'website', $websiteId);
    }
}
