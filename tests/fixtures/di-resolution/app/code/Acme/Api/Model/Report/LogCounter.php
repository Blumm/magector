<?php
declare(strict_types=1);

namespace Acme\Api\Model\Report;

class LogCounter
{
    public function __construct(private readonly \Magento\Framework\App\ResourceConnection $resource)
    {
    }

    public function count(): int
    {
        $c = $this->resource->getConnection();
        return (int)$c->fetchOne($c->select()->from($this->resource->getTableName('acme_log'), 'COUNT(*)'));
    }
}
