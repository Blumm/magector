<?php
declare(strict_types=1);

namespace Acme\Api\Controller\Adminhtml\Log;

class Index extends \Magento\Backend\App\Action implements \Magento\Framework\App\Action\HttpGetActionInterface
{
    public const ADMIN_RESOURCE = 'Acme_Api::repo';

    public function execute()
    {
        return $this->resultFactory->create(\Magento\Framework\Controller\ResultFactory::TYPE_PAGE);
    }
}
