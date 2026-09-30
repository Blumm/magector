<?php
declare(strict_types=1);

namespace Acme\Api\Cron;

class Cleanup
{
    public function __construct(private readonly \Acme\Api\Model\ResourceModel\Log $log)
    {
    }

    public function execute(): void
    {
        $this->log->purgeOlderThan(30);
    }
}
