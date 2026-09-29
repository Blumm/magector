<?php
declare(strict_types=1);

namespace Acme\Api\Model\ResourceModel;

class Log extends \Magento\Framework\Model\ResourceModel\Db\AbstractDb
{
    protected function _construct()
    {
        $this->_init('acme_log', 'log_id');
    }

    public function purgeOlderThan(int $days): int
    {
        return $this->getConnection()->delete($this->getMainTable(), ['created_at < ?' => date('Y-m-d', strtotime("-$days days"))]);
    }
}
